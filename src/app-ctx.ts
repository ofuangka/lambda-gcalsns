import moment, { Moment } from 'moment-timezone';
import { DynamoDB } from "aws-sdk";
import { google, calendar_v3 } from "googleapis";
import { Credentials, OAuth2Client } from "google-auth-library";
import { MonthlySmsCountDatastoreService } from "./aws/monthly-sms-count-datastore.service";
import { GoogleAuthTokenDatastoreService, GoogleAuthToken } from "./aws/google-auth-token-datastore.service";
import { EmailService } from "./aws/email.service";
import { SmsService } from "./aws/sms.service";
import { Logger, LoggerFactory } from "./util/logger";
import { ContactsService, PhoneBook } from "./google/contacts.service";
import { ScheduleService } from "./google/schedule.service";

const EVENT_SUMMARY_REGEX = /\*([^\*]+)\*/;
const TMPL_VAR_REGEX = /\{\{\s*([A-Z0-9_]+)\s*\}\}/ig;

interface EventInfo {
  contactName: string;
  eventName: string;
  textMessage: string;
  phoneNumber: string;
}

/**
 * configuration options
 */
export interface AppConfig {
  /**
   * enables verbose logging
   */
  verbose: boolean,

  /**
   * options related to emails
   */
  email: {

    /**
     * enables sending emails
     */
    enabled: boolean,

    /**
     * email from field
     */
    from: string,

    /**
     * email subject field
     */
    subject: string,

    /**
     * email recipients
     */
    recipients: string
  },

  /**
   * options related to sms texts
   */
  sms: {

    /**
     * enables sending texts
     */
    enabled: boolean,

    /**
     * reply to field
     */
    replyTo: string,

    /**
     * max texts per month
     */
    monthlyQuota: number,

    /**
     * max characters per text
     */
    maxChars: number,

    /**
     * text template
     */
    template: string
  },

  /**
   * aws configuration options
   */
  aws: {

    /**
     * aws region (e.g. us-west-1)
     */
    region: string,

    /**
     * access key ID
     */
    accessKeyId: string,

    /**
     * access secret
     */
    secretAccessKey: string
  },

  /**
   * google configuration options
   */
  google: {

    /**
     * event calendar ID
     */
    calendarId: string,

    /**
     * client secret
     */
    clientSecret: string,

    /**
     * client ID
     */
    clientId: string,

    /**
     * oauth2 redirect URL
     */
    redirectUrl: string,

    /**
     * contact sheets ID
     */
    contactsId: string,

    /**
     * contact sheet range
     */
    spreadsheetRange: string,
  },

  /**
   * time configuration options
   */
  time: {

    /**
     * default time zone, IANA format (e.g. US/Central)
     */
    defaultTimeZone: string,

    /**
     * date format (momentjs)
     */
    dateFormat: string,

    /**
     * time format (momentjs)
     */
    timeFormat: string
  }
}

/**
 * Represents the context for a single application run
 */
export class AppContext {

  private lf: LoggerFactory;
  private log: Logger;

  private auth: OAuth2Client;
  private contactsService: ContactsService | undefined;
  private scheduleService: ScheduleService | undefined;

  private dynamodb: DynamoDB.DocumentClient;
  private smsCountDb: MonthlySmsCountDatastoreService;
  private googleTokenDb: GoogleAuthTokenDatastoreService;

  private emailService: EmailService;
  private smsService: SmsService;

  private phoneBook: PhoneBook = {};
  private todaysEvents: calendar_v3.Schema$Event[] = [];
  private oldCount = 0;
  private sentCount = 0;
  private appEvents: string[] = [];

  /**
   * The datetime when the app was started
   */
  public appStart: Moment;

  /**
   * Constructor
   * @param config The application configuration
   */
  constructor(public config: AppConfig) {
    this.appStart = moment();
    this.lf = new LoggerFactory(config.verbose);
    this.log = this.lf.getLogger(AppContext.name);
    this.log.info('Starting application...');
    this.log.verbose('Configuration', JSON.stringify(config));
    this.dynamodb = new DynamoDB.DocumentClient({
      accessKeyId: this.config.aws.accessKeyId,
      region: this.config.aws.region,
      secretAccessKey: this.config.aws.secretAccessKey
    });
    this.auth = new google.auth.OAuth2(
      this.config.google.clientId,
      this.config.google.clientSecret,
      this.config.google.redirectUrl);
    this.googleTokenDb = new GoogleAuthTokenDatastoreService(this.dynamodb, this);
    this.smsCountDb = new MonthlySmsCountDatastoreService(this.dynamodb, this);
    this.emailService = new EmailService(this);
    this.smsService = new SmsService(this);
  }

  /**
   * Authorize use of services
   * 
   * @returns A promise that resolves with this
   * AppContext instance when the event completes
   */
  public authorize(): Promise<AppContext> {
    return this.lifecycleEvent(this.authorize.name,
      this.googleTokenDb.getToken()
        .then(token => this.authorizeGoogleServices(token))
    );
  }

  /**
   * Fetch prerequisite data
   * 
   * @returns A promise that resolves with this AppContext
   * instance when the event completes
   */
  public fetchData(): Promise<AppContext> {
    return this.lifecycleEvent(this.fetchData.name, Promise.all([
      this.contactsService!.getContacts(this.config.google.contactsId)
        .then(phoneBook => this.phoneBook = phoneBook),
      this.scheduleService!.getCalendar(this.config.google.calendarId)
        .then(calendar => this.scheduleService!.getTodaysEvents(calendar))
        .then(todaysEvents => this.todaysEvents = todaysEvents),
      this.smsCountDb.getCurrentCount().then(count => this.oldCount = count)
    ]));
  }

  /**
   * Process events when there are events to process
   * 
   * @returns A promise that resolves with this AppContext 
   * instance when the event completes
   */
  public processEvents(): Promise<AppContext> {
    if (this.todaysEvents.length === 0) {
      this.appEvents.push(`No upcoming events for today.`);
      return Promise.resolve(this);
    }
    return this.lifecycleEvent(this.processEvents.name,
      Promise.all(this.todaysEvents.map(event => this.processEvent(event)))
        .then(results => results.forEach(result => this.appEvents.push(result))));
  }

  /**
   * Store results and send a summary email
   * 
   * @returns A promise that resolves with the results of finalizing
   */
  public finalize(): Promise<string[]> {
    return Promise.all([
      this.smsCountDb.updateCount(this.oldCount + this.sentCount)
        .then(result => `Stored updated ${result.month} SMS count ${result.count}`),
      this.emailService.sendHtmlEmail(this.summarizeAppEvents(this.appEvents)),
      this.updateTokenOnRefresh(this.auth.credentials)
    ]);
  }

  /**
   * Retrieves a logger given an id
   * @param id The id of the logger to retrieve
   * 
   * @returns The logger
   */
  public getLogger(id: string): Logger {
    return this.lf.getLogger(id);
  }

  /**
   * Executes a lifecycle event
   * 
   * @param eventName The lifecycle event name
   * @param promise A promise that resolves when the lifecycle event completes
   * 
   * @returns A promise that resolves to this AppContext instance when the lifecycle event completes
   */
  private async lifecycleEvent(eventName: string, promise: Promise<any>): Promise<AppContext> {
    this.log.info(`Beginning ${eventName}...`);
    try {
      await promise;
      this.log.info(`${eventName} successful.`);
      return this;
    } catch (err) {
      this.log.error(`${eventName} failed.`);
      throw err;
    }
  }

  /**
   * Checks if the monthly text quota has been reached
   * 
   * @returns true if it has been reached
   */
  private isMonthlyQuotaReached(): boolean {
    return !((this.oldCount + this.sentCount) < this.config.sms.monthlyQuota);
  }

  /**
   * Processes a Google Calendar event
   * 
   * @param event A Google Calendar event
   * 
   * @returns a promise resolving to a string containing a human readable result of processing
   */
  private async processEvent(event: calendar_v3.Schema$Event): Promise<string> {
    this.log.verbose(`Processing event '${event.summary}'...`);

    /* before we send a text, make sure the quota hasn't been reached */
    if (!this.isMonthlyQuotaReached()) {
      try {

        const eventInfo = this.readEventInfo(event);

        /* try to send the notification. if it is successful, increment the count. otherwise log the failure */
        const sent = await this.smsService.sendTextMessage(eventInfo.textMessage, eventInfo.phoneNumber);
        if (sent) {
          this.sentCount++;
          return `Text sent to ${eventInfo.phoneNumber}: ${eventInfo.textMessage}`;
        }
        return `Text would have been sent to ${eventInfo.phoneNumber}: ${eventInfo.textMessage}`;
      } catch (err) {
        return `An error occurred during while processing ${event.summary}: ${JSON.stringify(err)}`;
      }
    }
    return `Monthly quota was reached: (${this.oldCount + this.sentCount}/${this.config.sms.monthlyQuota})`;
  }

  /**
   * Authorizes with Google services
   * 
   * @param token An auth token
   */
  private authorizeGoogleServices(token: GoogleAuthToken): void {
    google.options({ auth: this.auth });
    this.auth.setCredentials({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expiry_date: token.expiry_date
    });
    this.contactsService = new ContactsService(this.auth, this);
    this.scheduleService = new ScheduleService(this.auth, this);
  }

  /**
   * Reads relevant information from a Google Calendar event
   * 
   * @param event A Google Calendar event
   * 
   * @returns An EventInfo object containing the relevant event information
   */
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

  /**
   * Saves credentials
   * 
   * @param auth The Google credentials object
   */
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
   * 
   * @param appEvents The application events to summarize
   * 
   * @returns The app event summary
   */
  private summarizeAppEvents(appEvents: string[]): string {
    return [`<h1>Summary for ${moment().tz(this.config.time.defaultTimeZone).format(this.config.time.dateFormat)}</h1>`,
    `<ul>${appEvents.map(item => `<li>${item}</li>`).join('')}</ul>`].join();
  }

  /**
   * Generates a message for an event in a given timeZone, limiting the characters
   * 
   * @param event A Google Calendar event
   * @param tmplVars The template variables to use when interpolating the message template
   * 
   * @returns The complete text message
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

    /* combine the template with an object containing the template variables */
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
  private interpolate(tmpl: string, tmplVars: { [key: string]: string }): string {
    var matches,
      ret = tmpl;
    while ((matches = TMPL_VAR_REGEX.exec(tmpl)) !== null) {
      ret = ret.replace(matches[0], tmplVars[matches[1]] || '?');
    }
    return ret;
  }
}
