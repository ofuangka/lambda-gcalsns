import { OAuth2Client } from "googleapis-common";
import { sheets_v4, google } from "googleapis";
import { AppContext } from "../app-ctx";
import { Logger } from "../util/logger";

export class ContactsService {

  private log: Logger;
  private sheets: sheets_v4.Sheets;

  constructor(auth: OAuth2Client, private context: AppContext) {
    this.log = context.getLogger('ContactsService');
    this.sheets = google.sheets({
      version: 'v4',
      auth: auth
    });
  }

  getContacts(sheetsId: string): Promise<{ [key: string]: string }> {
    this.log.info(`Retrieving contacts...`);
    this.log.verbose(`sheetsId: ${sheetsId}`);
    return this.getSheetRange(sheetsId).then(range => this.parseContacts(range));
  }

  /**
   * Generates a JavaScript object map of contacts to phone numbers
   * 
   * @param range {object} A google ValueRange 
   */
  private parseContacts(range: sheets_v4.Schema$ValueRange): { [key: string]: string } {
    var ret: { [key: string]: string } = {};
    (range.values || [])
      .forEach(columns => {
        ret[columns[0].trim().toLowerCase()] = this.formatPhone(columns[1]);
      });
    this.log.verbose('parseContacts:', ret);
    return ret;
  }

  private getSheetRange(sheetsId: string): Promise<sheets_v4.Schema$ValueRange> {
    this.log.verbose(`Google Sheets request for ${sheetsId}...`);
    return this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: this.context.config.google.spreadsheetRange
    })
      .then(response => response.data);
  }

  /**
   * Attempts to parse a phone number from a string and formats it in the AWS expected US format
   * 
   * @param {string} s An unformatted phone number
   * @returns A formatted phone number, or a blank string if the phone number could not be parsed
   */
  private formatPhone(s: string): string {

    if (typeof s === 'string') {
      var ret = s.replace(/[^0-9]/g, '');
      if (ret.length === 11 && ret.charAt(0) === '1') {
        return `+${ret}`;
      } else if (ret.length === 10) {
        return `+1${ret}`;
      }
    }
    return '';
  }
}
