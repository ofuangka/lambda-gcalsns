import { google, calendar_v3 } from "googleapis";
import { DynamoDB } from "aws-sdk";
import { Credentials, OAuth2Client } from "google-auth-library";
import moment from 'moment-timezone';
import { MonthlySmsCountDatastoreService } from "./aws/monthly-sms-count-datastore.service";
import { GoogleAuthTokenDatastoreService } from "./aws/google-auth-token-datastore.service";
import { EmailService } from "./aws/email.service";
import { SmsService } from "./aws/sms.service";
import { Logger, LoggerFactory } from "./util/logger";
import { ContactsService } from "./google/contacts.service";
import { ScheduleService } from "./google/schedule.service";

const EVENT_SUMMARY_REGEX = /\*([^\*]+)\*/;
const TMPL_VAR_REGEX = /\{\{\s*([A-Z0-9_]+)\s*\}\}/ig;

type PhoneBook = { [key: string]: string };

export interface AppConfig {
  verbose: boolean,
  email: {
    enabled: boolean,
    from: string,
    subject: string,
    recipients: string
  },
  sms: {
    enabled: boolean,
    replyTo: string,
    monthlyQuota: number,
    maxChars: number,
    template: string
  },
  aws: {
    region: string,
    accessKeyId: string,
    secretAccessKey: string
  },
  google: {
    calendarId: string,
    clientSecret: string,
    clientId: string,
    redirectUrl: string,
    contactsId: string,
    spreadsheetRange: string,
  },
  time: {
    defaultTimeZone: string,
    dateFormat: string,
    timeFormat: string
  }
}

interface EventInfo {
  contactName: string;
  eventName: string;
  textMessage: string;
  phoneNumber: string;
}

export class AppContext {

  private log: Logger;

  private auth: OAuth2Client | undefined;
  private contactsService: ContactsService | undefined;
  private scheduleService: ScheduleService | undefined;

  private dynamodb: DynamoDB.DocumentClient;
  private smsCountDb: MonthlySmsCountDatastoreService | undefined;
  private googleTokenDb: GoogleAuthTokenDatastoreService | undefined;

  private emailService: EmailService | undefined;
  private smsService: SmsService | undefined;

  private phoneBook: PhoneBook = {};
  private todaysEvents: calendar_v3.Schema$Event[] = [];
  private oldCount = 0;
  private sentCount = 0;
  private appEvents: string[] = [];

  appStart = moment();

  constructor(public config: AppConfig, private lf: LoggerFactory) {
    this.log = lf.getLogger('AppContext');
    this.dynamodb = new DynamoDB.DocumentClient({
      accessKeyId: this.config.aws.accessKeyId,
      region: this.config.aws.region,
      secretAccessKey: this.config.aws.secretAccessKey
    });
  }

  async initialize(): Promise<AppContext> {
    this.googleTokenDb = new GoogleAuthTokenDatastoreService(this.dynamodb, this);
    this.smsCountDb = new MonthlySmsCountDatastoreService(this.dynamodb, this);
    this.emailService = new EmailService(this);
    this.smsService = new SmsService(this);
    return this.googleTokenDb.getToken()
      .then(token => {
        this.auth = new google.auth.OAuth2(this.config.google.clientId, this.config.google.clientSecret, this.config.google.redirectUrl);
        google.options({ auth: this.auth });
        this.auth.setCredentials({
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expiry_date: token.expiry_date
        });
        this.contactsService = new ContactsService(this.auth, this);
        this.scheduleService = new ScheduleService(this.auth, this);
      })
      .then(() => this);
  }

  /**
   * Fetches prerequisite data (the phonebook and today's schedule)
   */
  async fetchData(): Promise<AppContext> {
    this.log.info(`Fetching data...`);
    try {
      await Promise.all([
        this.contactsService!.getContacts(this.config.google.contactsId)
          .then(phoneBook => this.phoneBook = phoneBook),
        this.scheduleService!.getCalendar(this.config.google.calendarId)
          .then(calendar => this.scheduleService!.getTodaysEvents(calendar))
          .then(todaysEvents => this.todaysEvents = todaysEvents),
        this.smsCountDb!.getCurrentCount().then(count => this.oldCount = count)
      ]);
    } catch (err) {
      this.log.error(`Fetch data failed.`);
      throw err;
    }
    return this;
  }

  /**
   * Processes the events
   */
  processEvents(): Promise<AppContext> {
    this.log.info(`Processing events...`);
    if (!this.todaysEvents || !this.phoneBook) {
      throw new Error(`processData() without events or phoneBook, was fetchData() called?`);
    }
    if (this.todaysEvents.length > 0) {
      return Promise.all(this.todaysEvents
        .map(event => this.processEvent(event)))
        .then(results => results.forEach(result => this.appEvents.push(result)))
        .then(() => this);
    }
    this.appEvents.push(`No upcoming events for today`);
    return Promise.resolve(this);
  }

  /**
   * Finish up
   */
  finalize(): Promise<string[]> {
    this.log.info('Finalizing...');
    return Promise.all([
      this.smsCountDb!.updateCount(this.oldCount + this.sentCount).then(result => `Stored updated ${result.month} SMS count ${result.count}`),
      this.emailService!.sendHtmlEmail(this.summarizeAppEvents(this.appEvents)),
      this.updateTokenOnRefresh(this.auth!.credentials)
    ]);
  }

  /**
   * Retrieves a Logger given an id
   * @param id The Logger id to retrieve
   */
  getLogger(id: string): Logger {
    return this.lf.getLogger(id);
  }

  private monthlyQuotaReached(): boolean {
    return !((this.oldCount + this.sentCount) < this.config.sms.monthlyQuota);
  }

  private async processEvent(event: calendar_v3.Schema$Event): Promise<string> {
    this.log.verbose(`Event summary '${event.summary}'...`);
    try {
      const eventInfo = this.readEventInfo(event);

      /* before we send an SMS, make sure the quota hasn't been reached */
      if (!this.monthlyQuotaReached()) {

        /* try to send the notification. if it is successful, increment the count. otherwise log the failure */
        const sent = await this.smsService!.sendTextMessage(eventInfo.textMessage, eventInfo.phoneNumber);
        if (sent) {
          this.sentCount++;
        }
        return `SMS ${sent ? 'sent' : 'prevented'} to ${eventInfo.phoneNumber}: ${eventInfo.textMessage}`;

      }
      return `Monthly quota was reached: (${this.oldCount + this.sentCount}/${this.config.sms.monthlyQuota})`;
    } catch (err) {
      return err;
    }
  }

  private readEventInfo(event: calendar_v3.Schema$Event): EventInfo {

    let contactId;
    let contactName;
    let eventName;

    if (!event.summary) {
      throw new Error('Event has no summary');
    }

    /* if we can parse the summary, return the contactName and the stripped message */
    const captureGroups = EVENT_SUMMARY_REGEX.exec(event.summary);
    if (captureGroups) {
      contactName = captureGroups[1];
      contactId = contactName.toLowerCase();
      eventName = event.summary.replace(EVENT_SUMMARY_REGEX, '');
    } else {
      throw `Non-notification event: ${event.summary}`;
    }

    if (!this.phoneBook.hasOwnProperty(contactId)) {
      throw new Error(`No phone number for ${contactName}`);
    }

    return {
      contactName: contactName,
      textMessage: this.toTextMessage(event, {
        eventSummary: eventName,
        recipientName: contactName,
        smsReplyTo: this.config.sms.replyTo
      }),
      eventName: eventName,
      phoneNumber: this.phoneBook[contactId]
    };
  }

  private async updateTokenOnRefresh(auth: Credentials): Promise<string> {
    if (auth && auth.id_token && auth.access_token && auth.expiry_date && auth.refresh_token) {
      try {
        await this.googleTokenDb!.saveToken({
          access_token: auth.access_token,
          expiry_date: auth.expiry_date,
          refresh_token: auth.refresh_token
        });
        return 'Saved updated GoogleAuthToken';
      } catch (err) {
        return `Error saving updated GoogleAuthToken: ${JSON.stringify(err)}`;
      }
    }
    return 'No GoogleAuthToken update necessary';
  }

  /**
   * Generates an HTML summary of the application events
   * @param appEvents The application events to summarize
   */
  private summarizeAppEvents(appEvents: string[]): string {
    return `<h1>Summary for ${moment().tz(this.config.time.defaultTimeZone).format(this.config.time.dateFormat)}</h1><ul>${appEvents.map(item => `<li>${item}</li>`).join('')}</ul>`;
  }

  /**
   * Generates a message for an event in a given timeZone, limiting the characters
   * 
   * @param event A Google Calendar event
   * @param tmplVars The template variables to use when interpolating the message template
   */
  private toTextMessage(event: calendar_v3.Schema$Event, tmplVars: { [key: string]: string }): string {
    let start,
      timeZone = event.start!.timeZone!;
    if (event.start!.date) {

      /* an all day event */
      start = moment.tz(event.start!.date, 'YYYY-MM-DD', timeZone).startOf('day');
    } else {
      start = moment(event.start!.dateTime, moment.ISO_8601).tz(timeZone);
    }
    return this.interpolate(this.config.sms.template, Object.assign({
      date: start.format(this.config.time.dateFormat),
      time: start.format(this.config.time.timeFormat)
    }, tmplVars)).substr(0, this.config.sms.maxChars);
  }

  /**
   * Attempt variable substitution in a template
   * 
   * @param tmpl The template with variables to replace
   * @param tmplVars A map of template variable names to values
   * @returns The template with variable names replaced with variable values, or '?' if the 
   *   variable value was not available
   */
  interpolate(tmpl: string, tmplVars: { [key: string]: string }): string {
    var matches,
      ret = tmpl;
    while ((matches = TMPL_VAR_REGEX.exec(tmpl)) !== null) {
      ret = ret.replace(matches[0], tmplVars[matches[1]] || '?');
    }
    return ret;
  }
}
