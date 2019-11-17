import { OAuth2Client } from "googleapis-common";
import { sheets_v4, google } from "googleapis";
import { AppContext } from "../app-ctx";
import { Logger } from "../util/logger";

export type PhoneBook = { [key: string]: string };

/**
 * Service that retrieves contact information
 */
export class ContactsService {

  private log: Logger;
  private sheets: sheets_v4.Sheets;

  /**
   * Constructor
   * 
   * @param auth An OAuth2Client
   * @param context The application context
   */
  constructor(auth: OAuth2Client, private context: AppContext) {
    this.log = context.getLogger('ContactsService');
    this.sheets = google.sheets({
      version: 'v4',
      auth: auth
    });
  }

  /**
   * Retrieves contact information
   * 
   * @param sheetsId The Google Sheets ID to retrieve
   * 
   * @returns a map of contact IDs to phone numbers
   */
  public getContacts(sheetsId: string): Promise<PhoneBook> {
    this.log.info(`Retrieving contacts...`);
    return this.getSheetRange(this.context.config.google.spreadsheetRange, sheetsId)
      .then(range => this.parseContacts(range));
  }

  /**
   * Generates a JavaScript object map of contacts to phone numbers
   * 
   * @param range {object} A google ValueRange 
   * 
   * @returns a map of contact IDs to phone numbers
   */
  private parseContacts(range: sheets_v4.Schema$ValueRange): PhoneBook {
    this.log.info("Parsing contacts...")
    var ret: PhoneBook = {};
    (range.values || [])
      .filter(row => row.length > 1)
      .forEach(row => {
        const contactId = row[0].trim().toLowerCase();
        const phoneNumber = this.formatPhone(row[1]);
        if (contactId && phoneNumber) {
          ret[contactId] = phoneNumber;
        } else {
          this.log.error(`Could not parse contact row ${JSON.stringify(row)}`);
        }
      });
    this.log.verbose('Parsed contacts:', ret);
    return ret;
  }

  /**
   * Retrieves a subset of a Google Sheet
   * 
   * @param sheetRange The sheet range to retrieve
   * @param sheetsId Retrieves a subset of a Google sheet
   */
  private getSheetRange(sheetRange: string, sheetsId: string): Promise<sheets_v4.Schema$ValueRange> {
    this.log.verbose(`Requesting Google Sheet ID ${sheetsId}...`);
    return this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: sheetRange
    })
      .then(response => response.data);
  }

  /**
   * Attempts to parse a phone number from a string and formats it in the AWS expected US format
   * 
   * @param s An unformatted phone number
   * 
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
