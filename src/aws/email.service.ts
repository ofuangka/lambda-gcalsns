import { SES } from "aws-sdk";

import { Logger } from "../util/logger";
import { AppContext } from "../app-ctx";

/**
 * Services related to email
 */
export class EmailService {

  private log: Logger;

  private ses: SES;
  private recipients: string[];

  /**
   * Constructs the service
   * 
   * @param context The application configuration
   */
  constructor(private context: AppContext) {
    this.log = context.getLogger('EmailService');

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
   * @returns A Promise containing the result
   */
  sendHtmlEmail(html: string): Promise<string> {
    this.log.info(`Sending email...`, this.context.config.email.enabled ? '-Production-' : '-Simulation-');
    this.log.verbose(`summary: ${html}`);

    if (!Array.isArray(this.recipients) || this.recipients.length == 0) {
      return Promise.resolve('No email recipients, skipping email send');
    }
    if (this.context.config.email.enabled) {
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
        this.log.verbose(`Sending SES object ${email}...`);
        return this.ses.sendEmail(email).promise()
          .then(result => result.MessageId ? `SES object sent with MessageId ${result.MessageId}` : `SES object sending failed with result ${JSON.stringify(result)}`);
      } catch (err) {
        return Promise.resolve(`Error when sending email: ${JSON.stringify(err)}`);
      }
    }
    return Promise.resolve("Email disabled in config");
  }
}
