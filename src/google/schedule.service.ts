
import { OAuth2Client } from "googleapis-common";
import { calendar_v3, google } from "googleapis";
import moment from "moment-timezone";
import { Logger } from "../util/logger";
import { AppContext } from "../app-ctx";

export class ScheduleService {

  private gcal: calendar_v3.Calendar;

  private log: Logger;

  constructor(auth: OAuth2Client, private context: AppContext) {
    this.log = context.getLogger('ScheduleService');
    this.gcal = google.calendar({
      version: 'v3',
      auth: auth
    });
  }

  /**
   * Retrieves a Google Calendar
   * @param {string} calendarId The calendar to retrieve
   */
  getCalendar(calendarId: string): Promise<calendar_v3.Schema$Calendar> {
    this.log.verbose(`Requesting Google Calendar ID ${calendarId}...`);
    return this.gcal.calendars.get({
      calendarId: calendarId

    })
      .then(response => response.data);
  }

  /**
   * Lists the events of a Google Calendar for a given time period
   * @param {string} calendarId The calendar to retrieve events for
   * @param {string} start The timeMin, in ISOString format
   * @param {string} end The timeMax, in ISOString format
   */
  getEvents(calendarId: string, start: string, end: string): Promise<calendar_v3.Schema$Event[]> {
    this.log.info(`Retrieving calendar events from ${start} to ${end}...`);
    return this.gcal.events.list({
      calendarId: calendarId,
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: 'startTime'
    })
      .then(response => {
        if (!response.data) {
          throw new Error(`No data in response: ${response}`);
        }
        return response.data;
      })
      .then(data => data.items || []);
  }

  /**
   * Retrieves events for the current day
   * @param calendar The calendar to retrieve events from
   */
  getTodaysEvents(calendar: calendar_v3.Schema$Calendar): Promise<calendar_v3.Schema$Event[]> {
    this.log.info(`Getting today's events...`);
    const timeZone = calendar.timeZone || this.context.config.time.defaultTimeZone;
    const nowTz = this.context.appStart.tz(timeZone);
    const ymd = [nowTz.year(), nowTz.month(), nowTz.date()];
    const bod = moment.tz(ymd, timeZone).startOf('day').toISOString();
    const eod = moment.tz(ymd, timeZone).endOf('day').toISOString();
    return this.getEvents(calendar.id!, bod, eod);
  }
}
