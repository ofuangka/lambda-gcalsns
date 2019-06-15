
import { AppCfg } from './app-cfg';
import { AppContext } from './app-ctx';
import { Logger } from './logger';

export const handler = function () {

  /**
   * Read in the configuration values from the execution environment
   */
  const appCfg: AppCfg = {
    verbose: !!process.env.IS_VERBOSE,
    email: {
      enabled: !!process.env.IS_EMAIL_ENABLED,
      from: process.env.EMAIL_FROM || 'do-not-reply@domain.com',
      subject: process.env.EMAIL_SUBJECT || 'SMS Notifications',
      recipients: process.env.EMAIL_RECIPIENTS || ''
    },
    sms: {
      enabled: !!process.env.IS_SMS_ENABLED,
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
  };

  Logger.setVerbose(appCfg.verbose);
  const log = Logger.getLogger('main');
  log.info('Starting handler...');
  log.verbose('appCfg:', appCfg);
  new AppContext(appCfg)
    .fetchData()
    .then(ctx => ctx.processEvents())
    .then(ctx => ctx.finalize())
    .catch(err => console.error(err));
};
