import { SES } from "aws-sdk";

import { AppCfg } from "../app-cfg";
import { Logger } from "../logger";

/**
 * Services related to email
 */
export class EmailService {

  private static log = Logger.getLogger('EmailService');

  private ses: SES;
  private recipients: string[];

  /**
   * Constructs the service
   * 
   * @param cfg The application configuration
   */
  constructor(private cfg: AppCfg) {
    this.ses = new SES({
      region: cfg.aws.region,
      accessKeyId: cfg.aws.accessKeyId,
      secretAccessKey: cfg.aws.secretAccessKey
    });

    /* split the recipients */
    this.recipients = cfg.email.recipients.split(',').map(s => s.trim());
  }

  /**
   * Sends a summary email through AWS SES
   * 
   * @param {string} summary A summary to send
   * 
   * @returns A Promise containing the result
   */
  async sendSummaryEmail(summary: string): Promise<string> {
    EmailService.log.info(`Sending summary email...`, this.cfg.email.enabled ? '-Production-' : '-Simulation-');
    EmailService.log.verbose(`summary: ${summary}`);

    if (Array.isArray(this.recipients) && this.recipients.length > 0) {
      return 'No email recipients, skipping email send';
    }
    let result: SES.SendEmailResponse = {
      MessageId: 'SIMU'
    };
    if (this.cfg.email.enabled) {
      try {
        result = await this.ses.sendEmail({
          Destination: {
            ToAddresses: this.recipients
          },
          Message: {
            Body: {
              Html: {
                Data: summary
              }
            },
            Subject: {
              Data: this.cfg.email.subject
            }
          },
          Source: this.cfg.email.from
        }).promise();
      } catch (err) {
        return `Error when sending email: ${JSON.stringify(err)}`;
      }
    }
    return result.MessageId ? `Email sent with MessageId ${result.MessageId}` : `Unexpected response from SES when sending email: ${JSON.stringify(result)}`;
  }
}
