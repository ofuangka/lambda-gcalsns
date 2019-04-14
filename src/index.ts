import { DynamoDB, SNS, SES, Request, AWSError } from 'aws-sdk';
import { calendar_v3, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import moment from 'moment-timezone';
import { calendar } from 'googleapis/build/src/apis/calendar';
import { sheets } from 'googleapis/build/src/apis/sheets';

const calendarId = process.env.CALENDAR_GCAL_ID || '',
    contactsId = process.env.CONTACTS_SHEETS_ID || '',
    from = process.env.EMAIL_FROM || '',
    subject = process.env.EMAIL_SUBJECT || '',
    smsReplyTo = process.env.SMS_REPLY_TO,
    awsConfig = {
        region: process.env.AWS_REGION_ || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID_,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_
    },
    credentials = {
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        clientId: process.env.GOOGLE_CLIENT_ID,
        redirectUrl: process.env.GOOGLE_REDIRECT_URL
    },
    isSmsEnabled = process.env.IS_SMS_ENABLED,
    isEmailEnabled = process.env.IS_EMAIL_ENABLED,
    isVerbose = process.env.IS_VERBOSE,
    spreadsheetRange = 'A:B',
    friendlyDateFormat = process.env.FRIENDLY_DATE_FORMAT || 'ddd, MMM Do',
    friendlyTimeFormat = process.env.FRIENDLY_TIME_FORMAT || 'h:mma',
    smsMessageTmpl = process.env.SMS_MESSAGE_TMPL || 'This message is to confirm {{ eventSummary }} on {{ date }} at {{ time }} for {{ recipientName }}. Please confirm by texting {{ smsReplyTo }} directly.';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
    NOTIFICATION_REGEX = /\*([^\*]+)\*/,
    TMPL_VAR_REGEX = /\{\{\s*([A-Z0-9_]+)\s*\}\}/ig,
    MONTH_NOTIFICATION_COUNT_TABLE = 'MonthNotificationCount',
    TOKEN_TABLE = 'Token',
    GCAL_TOKEN_ID = 'gcalsns-google',
    DEFAULT_MONTHLY_QUOTA = '100',
    DEFAULT_SMS_MAX_CHARS = '140';

/**
 * logs to the console, calling JSON.stringify on objects
 */
function log(...args: any[]) {
    console.log(args.map((argument: any) => typeof (argument === 'object') ? JSON.stringify(argument) : argument));
}

/**
 * calls log if isVerbose is true
 */
function verbose(...args: any[]) {
    if (isVerbose) {
        log.apply(null, args);
    }
}

/**
 * Makes an asynchronous function return a ES6 Promise 
 * 
 * @param {callable} fn Some asynchronous function that takes as the last argument a callback function 
 * @param {object} context The context in which to call the asynchronous function
 */
function toPromise<T>(fn: Function, context: any, ...fnArgs: any[]): Promise<T> {
    return new Promise(function (resolve, reject) {
        var args = fnArgs.length === 1 ? [fnArgs[0]] : Array.apply(null, fnArgs);
        fn.apply(context, args.slice(2).concat((err: any, response: any) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        }));
    });
}


/**
 * Retrieves the MonthNotificationCount
 * 
 * @param {string} month The month to retrieve, in the format YYYY-MM 
 * @param {object} dynamodb The database object
 */
function fetchMonthNotificationCount(month: string, dynamodb: DynamoDB.DocumentClient): Promise<number> {
    return toPromise<DynamoDB.GetItemOutput>(dynamodb.get, dynamodb, {
        Key: {
            Month: {
                S: month
            }
        },
        TableName: MONTH_NOTIFICATION_COUNT_TABLE
    }).then(response => (response.Item) ? parseInt(response.Item.Count.N || '0') : 0);
}

/**
 * Saves the MonthNotificationCount
 * 
 * @param {number} count The count to save 
 * @param {string} month The month to save, in the format YYYY-MM 
 * @param {object} dynamodb The database object
 */
function saveMonthNotificationCount(count: number, month: string, dynamodb: DynamoDB.DocumentClient): Promise<DynamoDB.PutItemOutput> {
    return toPromise<DynamoDB.PutItemOutput>(dynamodb.put, dynamodb, {
        TableName: MONTH_NOTIFICATION_COUNT_TABLE,
        Item: {
            Month: { S: month },
            Count: { N: `${count}` }
        }
    });
}

/**
 * Retrieves the Google Calendar API token
 * 
 * @param {object} dynamodb The database object 
 */
function fetchGcalToken(dynamodb: DynamoDB.DocumentClient): Promise<string> {
    return toPromise<DynamoDB.GetItemOutput>(dynamodb.get, dynamodb, {
        Key: {
            TokenId: {
                S: GCAL_TOKEN_ID
            }
        },
        TableName: TOKEN_TABLE
    })
        .then(response => {
            if (!response.Item) {
                throw new Error(`No Item in response: ${response}`);
            } else {
                return response.Item;
            }
        })
        .then(item => item.Content.S || '');
}

/**
 * Saves the Google Calendar API token
 * 
 * @param {object} gcalToken The token 
 * @param {object} dynamodb The database object
 */
function saveToken(gcalToken: any, dynamodb: DynamoDB.DocumentClient): Promise<DynamoDB.PutItemOutput> {
    return toPromise<DynamoDB.PutItemOutput>(dynamodb.put, dynamodb, {
        Item: {
            TokenId: {
                S: GCAL_TOKEN_ID
            },
            Content: gcalToken
        },
        TableName: TOKEN_TABLE
    });
}

/**
 * Authenticates against Google OAuth2
 * 
 * @param {object} gcalCredentials 
 * @param {object} gcalToken 
 */
function authorize(gcalCredentials: any, gcalToken: any): OAuth2Client {
    var ret = new OAuth2Client(gcalCredentials.clientId, gcalCredentials.clientSecret, gcalCredentials.redirectUrl);
    ret.setCredentials({
        access_token: gcalToken.access_token,
        refresh_token: gcalToken.refresh_token,
        expiry_date: gcalToken.expiry_date
    });
    return ret;
}

/**
 * Retrieves a Google Calendar
 * 
 * @param {string} calendarId The calendar to retrieve
 * @param {object} gcal An authenticated Google Calendar API object 
 */
function getCalendar(calendarId: string, gcal: calendar_v3.Calendar): Promise<calendar_v3.Schema$Calendar> {
    return gcal.calendars.get({
        calendarId: calendarId
    })
        .then(response => response.data);
}

/**
 * Lists the events of a Google Calendar for a given time period
 * 
 * @param {string} calendarId The calendar to retrieve events for
 * @param {string} start The timeMin, in ISOString format
 * @param {string} end The timeMax, in ISOString format
 * @param {object} gcal An authenticated Google Calendar API object
 */
function listEvents(calendarId: string, start: string, end: string, gcal: calendar_v3.Calendar): Promise<calendar_v3.Schema$Event[]> {
    return gcal.events.list({
        calendarId: calendarId,
        timeMin: start,
        timeMax: end,
        singleEvents: true,
        orderBy: 'startTime'
    })
        .then(response => {
            if (!response.data) {
                throw new Error(`No data in response: ${response}`);
            }
            return response.data;
        })
        .then(data => data.items || []);
}

/**
 * Attempts to send an SMS notification through AWS SNS
 * 
 * @param {string} message The message to send 
 * @param {string} phoneNumber The phone number to send to (only US phone numbers supported)
 * @param {object} sns The AWS.SNS object
 */
function sendSmsNotification(message: string, phoneNumber: string, sns: SNS) {
    return toPromise<Request<SNS.PublishResponse, AWSError>>(sns.publish, sns, {
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Promotional'
            }
        }
    });
}

/**
 * Generates a JavaScript object map of contacts to phone numbers
 * 
 * @param range {object} A google ValueRange 
 */
function parseContacts(range: sheets_v4.Schema$ValueRange): { [key: string]: string } {
    var ret: { [key: string]: string } = {};
    (range.values || []).forEach(columns => {
        ret[columns[0].trim().toLowerCase()] = toPhoneNumber(columns[1]);
    });
    return ret;
}

function getContacts(sheetsId: string, sheets: sheets_v4.Sheets) {
    return getSheetRange(sheetsId, sheets).then(range => parseContacts(range));
}

function getSheetRange(sheetsId: string, sheets: sheets_v4.Sheets): Promise<sheets_v4.Schema$ValueRange> {
    return sheets.spreadsheets.values.get({
        spreadsheetId: sheetsId,
        range: spreadsheetRange
    })
        .then(response => response.data);
}

function getTimeZone(calendarId: string, gcal: calendar_v3.Calendar): Promise<string> {
    return getCalendar(calendarId, gcal).then(calendar => calendar.timeZone || 'US/Eastern');
}

function interpolate(tmpl: string, context: any) {
    var matches,
        ret = tmpl;
    while ((matches = TMPL_VAR_REGEX.exec(tmpl)) !== null) {
        ret = ret.replace(matches[0], context[matches[1]] || '?');
    }
    return ret;
}

/**
 * Generates a message for an event in a given timeZone, limiting the characters
 * 
 * @param {object} event A Google Calendar event 
 * @param {string} calTimeZone The timeZone of the Google Calendar
 * @param {object} context The context to use when interpolating the message template
 * @param {number} maxChars The maximum allowed characters in the message 
 */
function toMessage(event: any, calTimeZone: string, context: any, maxChars: number) {
    var start,
        timeZone = event.start.timeZone || calTimeZone;
    if (event.start.date) {

        /* an all day event */
        start = moment.tz(event.start.date, 'YYYY-MM-DD', timeZone).startOf('day');
    } else {
        start = moment(event.start.dateTime, moment.ISO_8601).tz(timeZone);
    }
    return interpolate(smsMessageTmpl, Object.assign({
        date: start.format(friendlyDateFormat),
        time: start.format(friendlyTimeFormat)
    }, context)).substr(0, maxChars);
}

/**
 * Generates a string summary
 * 
 * @param {object} log An array of logs 
 */
function toSummary(log: any[]) {
    return `<h1>${log[0]}</h1><ul>${log.slice(1).map(item => `<li>${item}</li>`).join('')}</ul>`;
}

/**
 * Sends a summary email through AWS SES
 * 
 * @param {string} summary A summary to send 
 * @param {object} recipients An array of recipient emails
 * @param {string} from The from email address
 * @param {string} subject The email subject
 * @param {object} ses An AWS.SES object
 */
function sendSummaryEmail(summary: string, recipients: string[], from: string, subject: string, ses: SES) {
    return toPromise(ses.sendEmail, ses, {
        Destination: {
            ToAddresses: recipients,
        },
        Message: {
            Body: {
                Html: {
                    Data: summary
                }
            },
            Subject: {
                Data: subject
            }
        },
        Source: from
    });
}

/**
 * Attempts to parse a phone number from a string
 * 
 * @param {string} s A phone number
 */
function toPhoneNumber(s: string): string {
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

export default {
    handler: function () {
        var monthlyQuota = parseInt(process.env.SMS_MONTHLY_QUOTA || DEFAULT_MONTHLY_QUOTA),
            maxChars = parseInt(process.env.SMS_MAX_CHARS || DEFAULT_SMS_MAX_CHARS),
            recipients = (process.env.EMAIL_RECIPIENTS || '').split(',').map(s => s.trim()),
            dynamodb = new DynamoDB.DocumentClient(awsConfig),
            now = moment(),
            quotaMonth = now.format('YYYY-MM'),
            smsDelta = 0;
        verbose('Fetching token');
        fetchGcalToken(dynamodb)
            .then(token => authorize(credentials, token))
            .then(auth => {
                var gcal = calendar({
                    version: 'v3',
                    auth: auth
                });
                var gsheets = sheets({
                    version: 'v4',
                    auth: auth
                });
                verbose('Getting contacts and timeZone');
                return Promise.all([auth, gcal,
                    getContacts(contactsId, gsheets),
                    getTimeZone(calendarId, gcal)
                ]);
            }).then(results => {
                var auth = results[0],
                    gcal = results[1],
                    contacts = results[2],
                    timeZone = results[3],
                    nowTz = now.tz(timeZone),
                    ymd = [nowTz.year(), nowTz.month(), nowTz.date()],
                    bod = moment.tz(ymd, timeZone).startOf('day').toISOString(),
                    eod = moment.tz(ymd, timeZone).endOf('day').toISOString();
                verbose('contacts:', contacts, 'timeZone:', timeZone);
                verbose('now:', now, 'nowTz:', nowTz, 'bod:', bod, 'eod:', eod);
                return Promise.all([
                    auth,
                    gcal,
                    contacts,
                    timeZone,
                    nowTz,
                    listEvents(calendarId, bod, eod, gcal),
                    fetchMonthNotificationCount(quotaMonth, dynamodb)
                ]);
            }).then(results => {
                var auth = results[0],
                    gcal = results[1],
                    contacts = results[2],
                    timeZone = results[3],
                    nowTz = results[4],
                    events = results[5],
                    smsStart = results[6],
                    sns = new SNS(awsConfig),
                    asyncLog: [string | Promise<string>] = [`Summary for ${nowTz.toString()}`];
                if (events.length == 0) {
                    asyncLog.push('No upcoming events found');
                } else {
                    events.forEach(event => {
                        const summary = event.summary || '';
                        var matches = NOTIFICATION_REGEX.exec(summary);
                        if (matches) {
                            var recipientName = matches[1],
                                phoneNumber = contacts[recipientName.toLowerCase()],
                                message = toMessage(event, timeZone, {
                                    eventSummary: summary.replace(NOTIFICATION_REGEX, '').trim(),
                                    recipientName: recipientName,
                                    smsReplyTo: smsReplyTo
                                }, maxChars);

                            if (phoneNumber && message && ((smsStart + smsDelta) < monthlyQuota)) {

                                if (isSmsEnabled) {

                                    /* try to send the notification. if it is successful, increment the count. otherwise log the failure */
                                    asyncLog.push(sendSmsNotification(message, phoneNumber, sns)
                                        .then(() => {
                                            smsDelta++;
                                            return `SMS sent to ${phoneNumber}: ${message}`;
                                        })
                                        .catch(err => {
                                            return `SMS to ${phoneNumber} failed: ${JSON.stringify(err)}`;
                                        }));
                                } else {
                                    asyncLog.push(`Simulate SMS to ${phoneNumber}: ${message}`);
                                }
                            } else {
                                asyncLog.push(`Invalid notification parameters: contact(${recipientName}), phone(${phoneNumber}), message(${message}), monthlyQuotaReached(${(smsStart + smsDelta) >= monthlyQuota})`);
                            }
                        } else {
                            asyncLog.push(`Non-notification event: ${event.summary}`);
                        }
                    });
                }

                /* wait for everything to complete, then send the summary. if the count has increased, save the new count */
                return Promise.all(([auth, smsStart] as any[]).concat(asyncLog));
            }).then(results => {
                var ses = new SES(awsConfig),
                    auth = results[0],
                    smsStart = results[1],
                    summaryLog = results.slice(2),
                    summary,
                    finalizationActions = [];
                summaryLog.push(`${smsStart + smsDelta} of ${monthlyQuota} SMS sent for ${now.format('MMM YYYY')}`);
                summary = toSummary(summaryLog);
                if (isEmailEnabled) {
                    verbose('Sending summary email');
                    finalizationActions.push(sendSummaryEmail(summary, recipients, from, subject, ses));
                } else {
                    log('Simulate sending summary email');
                    log(summary);
                }
                if (smsDelta > 0) {
                    verbose('Saving new count');
                    finalizationActions.push(saveMonthNotificationCount(smsStart + smsDelta, quotaMonth, dynamodb));
                }

                /* resave the token if an automatic refresh occurred */
                if (auth.credentials.id_token) {
                    verbose('Saving refreshed token');
                    finalizationActions.push(saveToken(auth.credentials, dynamodb));
                }
                return Promise.all(finalizationActions);
            }).catch(err => { throw err });
    }
};