export interface AppCfg {
  verbose: boolean,
  email: {
    enabled: boolean,
    from: string,
    subject: string,
    recipients: string
  },
  sms: {
    enabled: boolean,
    replyTo: string,
    monthlyQuota: number,
    maxChars: number,
    dateFormat: string,
    timeFormat: string,
    template: string
  },
  aws: {
    region: string,
    accessKeyId: string,
    secretAccessKey: string
  },
  google: {
    calendarId: string,
    clientSecret: string,
    clientId: string,
    redirectUrl: string,
    contactsId: string,
    spreadsheetRange: string,
  }
}