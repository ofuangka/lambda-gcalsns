
import { SNS } from "aws-sdk";

import moment from 'moment-timezone';
import { AppCfg } from "../app-cfg";
import { Logger } from "../logger";

const TMPL_VAR_REGEX = /\{\{\s*([A-Z0-9_]+)\s*\}\}/ig;

export class SmsService {

  private static log = Logger.getLogger('SmsService');

  private sns: SNS;

  constructor(private cfg: AppCfg) {
    this.sns = new SNS({
      accessKeyId: this.cfg.aws.accessKeyId,
      region: this.cfg.aws.region,
      secretAccessKey: this.cfg.aws.secretAccessKey
    });
  }

  /**
   * Attempts to send an SMS notification through AWS SNS
   * 
   * @param {string} message The message to send 
   * @param {string} phoneNumber The phone number to send to (only US phone numbers supported)
   * @param {object} sns The AWS.SNS object
   */
  async sendSmsNotification(message: string, phoneNumber: string): Promise<string> {
    SmsService.log.info(`Sending SMS...`, this.cfg.sms.enabled ? '-Production-' : '-Simulation-');
    SmsService.log.verbose(`phoneNumber: ${phoneNumber}`);
    SmsService.log.verbose(`message: ${message}`);

    let result: SNS.PublishResponse = {
      MessageId: 'SIMU'
    };
    if (this.cfg.sms.enabled) {
      try {
        result = await this.sns.publish({
          PhoneNumber: phoneNumber,
          Message: message,
          MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
              DataType: 'String',
              StringValue: 'Promotional'
            }
          }
        }).promise();
      } catch (err) {
        SmsService.log.info(`Error when sending SMS: ${err}`);
      }
    }
    return result.MessageId || '';
  }

  /**
   * Generates a message for an event in a given timeZone, limiting the characters
   * 
   * @param {object} event A Google Calendar event 
   * @param {string} calTimeZone The timeZone of the Google Calendar
   * @param {object} context The context to use when interpolating the message template
   */
  toMessage(event: any, calTimeZone: string, context: { [key: string]: string }): string {
    var start,
      timeZone = event.start.timeZone || calTimeZone;
    if (event.start.date) {

      /* an all day event */
      start = moment.tz(event.start.date, 'YYYY-MM-DD', timeZone).startOf('day');
    } else {
      start = moment(event.start.dateTime, moment.ISO_8601).tz(timeZone);
    }
    return this.interpolate(this.cfg.sms.template, Object.assign({
      date: start.format(this.cfg.sms.dateFormat),
      time: start.format(this.cfg.sms.timeFormat)
    }, context)).substr(0, this.cfg.sms.maxChars);
  }

  /**
   * Attempt variable substitution in a template
   * 
   * @param tmpl The template with variables to replace
   * @param context A map of template variable names to values
   * @returns The template with variable names replaced with variable values, or '?' if the 
   *   variable value was not available
   */
  private interpolate(tmpl: string, context: { [key: string]: string }): string {
    var matches,
      ret = tmpl;
    while ((matches = TMPL_VAR_REGEX.exec(tmpl)) !== null) {
      ret = ret.replace(matches[0], context[matches[1]] || '?');
    }
    return ret;
  }
}
