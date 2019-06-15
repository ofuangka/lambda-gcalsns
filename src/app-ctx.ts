import { google, calendar_v3 } from "googleapis";
import { DynamoDB } from "aws-sdk";
import { MonthlySmsCountDatastoreService } from "./aws/monthly-sms-count-datastore.service";
import { GoogleAuthToken, GoogleAuthTokenDatastoreService } from "./aws/google-auth-token-datastore.service";
import { AppCfg } from "./app-cfg";
import { EmailService } from "./aws/email.service";
import { SmsService } from "./aws/sms.service";
import { Logger } from "./logger";
import { ContactsService } from "./google/contacts.service";
import { ScheduleService } from "./google/schedule.service";
import { Credentials, OAuth2Client } from "google-auth-library";

const EVENT_SUMMARY_REGEX = /\*([^\*]+)\*/;

type PhoneBook = { [key: string]: string };

export class AppContext {

  private static log = Logger.getLogger('AppContext');

  private _authToken: Promise<GoogleAuthToken> | undefined;
  private _auth: OAuth2Client | undefined;
  private _emailService: EmailService | undefined;
  private _smsService: SmsService | undefined;
  private _contactsService: ContactsService | undefined;
  private _scheduleService: ScheduleService | undefined;

  private dynamodb: DynamoDB.DocumentClient;
  private smsCountDb: MonthlySmsCountDatastoreService;
  private googleTokenDb: GoogleAuthTokenDatastoreService;
  private phoneBook: PhoneBook = {};
  private todaysEvents: calendar_v3.Schema$Event[] = [];
  private oldCount: number = 0;
  private sentCount = 0;
  private appEvents: string[] = [];

  get authToken(): Promise<GoogleAuthToken> {
    if (!this._authToken) {
      this._authToken = this.googleTokenDb.getToken();
    }
    return this._authToken;
  }

  get auth(): Promise<OAuth2Client> {
    if (!this._auth) {
      return this.authToken
        .then(token => {
          const auth = new google.auth.OAuth2(this.cfg.google.clientId, this.cfg.google.clientSecret, this.cfg.google.redirectUrl);
          google.options({ auth: auth });
          auth.setCredentials({
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expiry_date: token.expiry_date
          });
          return this._auth = auth;
        });
    }
    return Promise.resolve(this._auth);
  }

  get emailService(): Promise<EmailService> {
    if (!this._emailService) {
      return Promise.resolve(this._emailService = new EmailService(this.cfg));
    }
    return Promise.resolve(this._emailService);
  }

  get smsService(): Promise<SmsService> {
    if (!this._smsService) {
      return Promise.resolve(this._smsService = new SmsService(this.cfg));
    }
    return Promise.resolve(this._smsService);
  }

  get contactsService(): Promise<ContactsService> {
    if (!this._contactsService) {
      return this.auth.then(auth => this._contactsService = new ContactsService(auth, this.cfg));
    }
    return Promise.resolve(this._contactsService);
  }

  get scheduleService(): Promise<ScheduleService> {
    if (!this._scheduleService) {
      return this.auth.then(auth => this._scheduleService = new ScheduleService(auth, this.cfg));
    }
    return Promise.resolve(this._scheduleService);
  }

  constructor(public cfg: AppCfg) {
    this.dynamodb = new DynamoDB.DocumentClient({
      accessKeyId: this.cfg.aws.accessKeyId,
      region: this.cfg.aws.region,
      secretAccessKey: this.cfg.aws.secretAccessKey
    });
    this.googleTokenDb = new GoogleAuthTokenDatastoreService(this.dynamodb);
    this.smsCountDb = new MonthlySmsCountDatastoreService(this.dynamodb, this.cfg);
  }

  /**
   * Fetches prerequisite data (the phonebook and today's schedule)
   */
  async fetchData(): Promise<AppContext> {
    AppContext.log.info(`Fetching data...`);
    await Promise.all([
      this.contactsService
        .then(contactsService => contactsService.getContacts(this.cfg.google.contactsId))
        .then(phoneBook => this.phoneBook = phoneBook),
      this.scheduleService
        .then(scheduleService => scheduleService.getTodaysEvents(this.cfg.google.calendarId))
        .then(todaysEvents => this.todaysEvents = todaysEvents)
    ]);
    return this;
  }

  /**
   * Processes the events
   */
  async processEvents(): Promise<AppContext> {
    AppContext.log.info(`Processing events...`);
    if (!this.todaysEvents || !this.phoneBook) {
      throw new Error(`processData() without events or phoneBook, was fetchData() called? (phoneBook: ${this.phoneBook}, todaysEvents ${this.todaysEvents})`);
    }
    if (this.todaysEvents.length > 0) {
      try {
        await this.todaysEvents
          .map(event => this.processEvent(event))
          .forEach(async (result) => this.appEvents.push(await result));
        return this;
      } finally {
        await this.smsCountDb.updateCount(this.oldCount + this.sentCount);
      }
    }
    this.appEvents.push(`No upcoming events for today`);
    return this;
  }

  private monthlyQuotaReached(): boolean {
    return !((this.oldCount + this.sentCount) < this.cfg.sms.monthlyQuota);
  }

  private async processEvent(event: calendar_v3.Schema$Event): Promise<string> {
    const eventSummary = event.summary || '';
    if (eventSummary.length == 0) {
      return `Empty eventSummary for event ${event}`;
    }
    const parsedSummary = this.parseEventSummary(eventSummary);
    if (parsedSummary && parsedSummary.contactName && parsedSummary.message) {

      /* look up the phone number */
      const phoneNumber = this.phoneBook[parsedSummary.contactName];

      /* before we send an SMS, make sure the quota hasn't been reached */
      if (!this.monthlyQuotaReached()) {

        /* try to send the notification. if it is successful, increment the count. otherwise log the failure */
        try {
          const smsService = await this.smsService;
          await smsService.sendSmsNotification(parsedSummary.message, phoneNumber);
          this.sentCount++;
          return `SMS sent to ${phoneNumber}: ${parsedSummary.message}`;
        } catch (err) {
          return `SMS to ${phoneNumber} failed: ${JSON.stringify(err)}`;
        }
      }
      return `Monthly quota was reached: (${this.oldCount + this.sentCount}/${this.cfg.sms.monthlyQuota})`;
    }
    return `Non-notification event: ${event.summary}`;
  }

  private parseEventSummary(eventSummary: string): { contactName: string, message: string } | null {

    /* if we can parse the summary, return the contactName and the stripped message */
    const captureGroups = EVENT_SUMMARY_REGEX.exec(eventSummary);
    if (captureGroups) {
      return {
        contactName: captureGroups[1],
        message: eventSummary.replace(EVENT_SUMMARY_REGEX, '')
      };
    }

    /* otherwise return null */
    return null;
  }

  async finalize(): Promise<AppContext> {
    AppContext.log.info('Finalizing...');
    await Promise.all([
      this.emailService.then(emailService => emailService.sendSummaryEmail(this.toEmailHtml(this.appEvents))),
      this.auth.then(auth => this.updateTokenOnRefresh(auth.credentials))
    ])
    return this;
  }

  private async updateTokenOnRefresh(auth: Credentials): Promise<string> {
    if (auth && auth.id_token && auth.access_token && auth.expiry_date && auth.refresh_token) {
      try {
        await this.googleTokenDb.saveToken({
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
   * Generates a string summary
   * 
   * @param {object} log An array of logs 
   */
  private toEmailHtml(log: string[]) {
    return `<h1>${log[0]}</h1><ul>${log.slice(1).map(item => `<li>${item}</li>`).join('')}</ul>`;
  }
}
