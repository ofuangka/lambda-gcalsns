
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
   * 
   * @param {string} calendarId The calendar to retrieve
   */
  private getCalendar(calendarId: string): Promise<calendar_v3.Schema$Calendar> {
    this.log.verbose(`Google Calendar request for ${calendarId}...`);
    return this.gcal.calendars.get({
      calendarId: calendarId

    })
      .then(response => response.data);
  }

  /**
   * Lists the events of a Google Calendar for a given time period
   * 
   * @param {string} calendarId The calendar to retrieve events for
   * @param {string} start The timeMin, in ISOString format
   * @param {string} end The timeMax, in ISOString format
   */
  getEvents(calendarId: string, start: string, end: string): Promise<calendar_v3.Schema$Event[]> {
    this.log.info(`Retrieving events...`);
    this.log.verbose(`calendarId: ${calendarId}`);
    this.log.verbose(`start: ${start}`);
    this.log.verbose(`end: ${end}`);
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

  getTodaysEvents(calendarId: string): Promise<calendar_v3.Schema$Event[]> {
    this.log.info(`Getting today's events...`);
    this.log.verbose(`calendarId: ${calendarId}`);
    return this.getCalendar(calendarId)
      .then(calendar => calendar.timeZone || 'US/Eastern')
      .then(timeZone => ({ timeZone: timeZone, nowTz: this.context.appStart.tz(timeZone) }))
      .then(result => ({
        timeZone: result.timeZone,
        ymd: [result.nowTz.year(), result.nowTz.month(), result.nowTz.date()]
      }))
      .then(result => ({
        bod: moment.tz(result.ymd, result.timeZone).startOf('day').toISOString(),
        eod: moment.tz(result.ymd, result.timeZone).endOf('day').toISOString()
      }))
      .then(range => this.getEvents(calendarId, range.bod, range.eod));
  }
}
