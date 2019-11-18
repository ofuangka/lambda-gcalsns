import { SES } from "aws-sdk";

import { Logger } from "../util/logger";
import { AppContext } from "../app-ctx";

/**
 * Services related to email
 */
export class EmailService {

  private static ID = 'EmailService';

  private log: Logger;
  private ses: SES;
  private recipients: string[];

  /**
   * Constructs the service
   * 
   * @param context The application configuration
   */
  constructor(private context: AppContext) {
    this.log = context.getLogger(EmailService.ID);

    this.ses = new SES({
      region: context.config.aws.region,
      accessKeyId: context.config.aws.accessKeyId,
      secretAccessKey: context.config.aws.secretAccessKey
    });

    /* split the recipients */
    this.recipients = context.config.email.recipients.split(',').map(s => s.trim());
  }

  /**
   * Sends an HTML email
   * 
   * @param html The HTML to send
   * 
   * @returns A promise containing the result
   */
  async sendHtmlEmail(html: string): Promise<string> {

    if (!Array.isArray(this.recipients) || this.recipients.length == 0) {
      return 'No email recipients, skipping email send.';
    }
    if (!this.context.config.email.enabled) {
      return 'Email disabled in config.';
    } else {
      this.log.info('Sending email...');
      try {
        const email: SES.SendEmailRequest = {
          Destination: {
            ToAddresses: this.recipients
          },
          Message: {
            Body: {
              Html: {
                Data: html
              }
            },
            Subject: {
              Data: this.context.config.email.subject
            }
          },
          Source: this.context.config.email.from
        };
        this.log.verbose('SES object:', email);
        return this.ses.sendEmail(email)
          .promise()
          .then(result => `Successfully sent email with MessageId ${result.MessageId}.`);
      } catch (err) {
        this.log.error(`Send email failed.`);
        throw err;
      }
    }
  }
}
