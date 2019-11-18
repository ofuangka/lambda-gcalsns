
import { SNS } from "aws-sdk";

import { Logger } from "../util/logger";
import { AppContext } from "../app-ctx";

/**
 * Service for sending SMS texts
 */
export class SmsService {

  private static ID = 'SmsService';

  private log: Logger;
  private sns: SNS;

  /**
   * Constructor
   * 
   * @param context The application context
   */
  constructor(private context: AppContext) {
    this.log = context.getLogger(SmsService.ID);
    this.sns = new SNS({
      accessKeyId: this.context.config.aws.accessKeyId,
      region: this.context.config.aws.region,
      secretAccessKey: this.context.config.aws.secretAccessKey
    });
  }

  /**
   * Attempts to send a text message
   * 
   * @param {string} message The message to send 
   * @param {string} phoneNumber The phone number to send to (only US phone numbers supported)
   * 
   * @returns A promise resolving to a string representing the result of the requset
   */
  public async sendTextMessage(message: string, phoneNumber: string): Promise<string> {
    if (!this.context.config.sms.enabled) {
      return 'Sending texts is currently disabled.';
    }
    this.log.info('Sending text...');
    try {
      const sms = {
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: 'Promotional'
          }
        }
      };
      return this.sns.publish(sms)
        .promise()
        .then(result => `Text sent with MessageId ${result.MessageId}.`);
    } catch (err) {
      this.log.info(`Error thrown when sending text.`);
      throw err;
    }
  }
}
