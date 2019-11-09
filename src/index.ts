import { Handler } from 'aws-lambda';

import { LoggerFactory } from './util/logger';
import { AppContext } from './app-ctx';

function main(context: AppContext): Promise<void | string> {
  return context.initialize()
    .then(ctx => ctx.fetchData())
    .then(ctx => ctx.processEvents())
    .then(ctx => ctx.finalize())
    .then(results => results.join("\n"))
    .catch(err => console.error(err));
}

function createAppContext(config: any): AppContext {
  return new AppContext(config,
    LoggerFactory.getInstance(config.verbose)
      .info('Starting handler...')
      .verbose('Configuration', config));
}

export const handler: Handler = () => {

  /**
   * Read in the configuration values from the execution environment
   */
  return main(createAppContext({
    verbose: process.env.IS_VERBOSE === 'true',
    email: {
      enabled: process.env.IS_EMAIL_ENABLED === 'true',
      from: process.env.EMAIL_FROM || 'do-not-reply@domain.com',
      subject: process.env.EMAIL_SUBJECT || 'SMS Notifications',
      recipients: process.env.EMAIL_RECIPIENTS || ''
    },
    sms: {
      enabled: process.env.IS_SMS_ENABLED === 'true',
      replyTo: process.env.SMS_REPLY_TO || '',
      monthlyQuota: process.env.SMS_MONTHLY_QUOTA ? parseInt(process.env.SMS_MONTHLY_QUOTA) : 100,
      maxChars: process.env.SMS_MAX_CHARS ? parseInt(process.env.SMS_MAX_CHARS) : 140,
      dateFormat: process.env.FRIENDLY_DATE_FORMAT || 'ddd, MMM Do',
      timeFormat: process.env.FRIENDLY_TIME_FORMAT || 'h:mma',
      template: process.env.SMS_MESSAGE_TMPL || 'This message is to confirm {{ eventSummary }} on {{ date }} at {{ time }} for {{ recipientName }}. Please confirm by texting {{ smsReplyTo }} directly.'
    },
    aws: {
      region: process.env.AWS_REGION_ || '',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID_ || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_ || ''
    },
    google: {
      calendarId: process.env.CALENDAR_GCAL_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      redirectUrl: process.env.GOOGLE_REDIRECT_URL || '',
      contactsId: process.env.CONTACTS_SHEETS_ID || '',
      spreadsheetRange: 'A:B',
    }
  }));
};