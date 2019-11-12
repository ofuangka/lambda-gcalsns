
import { SNS } from "aws-sdk";

import { Logger } from "../util/logger";
import { AppContext } from "../app-ctx";

export class SmsService {

  private log: Logger;
  private sns: SNS;

  constructor(private context: AppContext) {
    this.log = context.getLogger('SmsService');
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
   */
  sendTextMessage(message: string, phoneNumber: string): Promise<boolean> {
    this.log.info(`Sending Text...`, this.context.config.sms.enabled ? '-Production-' : '-Simulation-');
    if (this.context.config.sms.enabled) {
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
        return this.sns.publish(sms).promise().then(result => !!result.MessageId);
      } catch (err) {
        this.log.info(`Error when sending SNS object: ${JSON.stringify(err)}`);
        throw err;
      }
    }
    return Promise.resolve(false);
  }
}
