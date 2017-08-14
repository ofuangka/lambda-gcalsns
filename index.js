var aws = require('aws-sdk'),
    google = require('googleapis'),
    googleAuth = require('google-auth-library'),
    moment = require('moment-timezone');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'],
    NOTIFICATION_REGEX = /\*([^\*]+)\*/,
    MONTH_NOTIFICATION_COUNT_TABLE = 'MonthNotificationCount',
    TOKEN_TABLE = 'Token',
    GCAL_TOKEN_ID = 'gcalsns-google';

/**
 * Makes an asynchronous function return a ES6 Promise 
 * 
 * @param {callable} fn Some asynchronous function that takes as the last argument a callback function 
 * @param {object} context The context in which to call the asynchronous function
 */
function toPromise(fn, context) {
    return new Promise((resolve, reject) => {
        var args = arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments);
        fn.apply(context, args.slice(2).concat((err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        }));
    });
}

/**
 * Logs to the console if the IS_VERBOSE environment variables is truthy
 * 
 * @param {string} message 
 */
function verbose(message) {
    if (process.env.IS_VERBOSE) {
        console.log(message);
    }
}

/**
 * Retrieves the MonthNotificationCount
 * 
 * @param {string} month The month to retrieve, in the format YYYY-MM 
 * @param {object} db The database object
 */
function fetchMonthNotificationCount(month, db) {
    return toPromise(db.get, db, {
        Key: {
            Month: month
        },
        TableName: MONTH_NOTIFICATION_COUNT_TABLE
    }).then(response => (response.Item) ? response.Item.Count : 0);
}

/**
 * Saves the MonthNotificationCount
 * 
 * @param {number} count The count to save 
 * @param {string} month The month to save, in the format YYYY-MM 
 * @param {object} db The database object
 */
function saveMonthNotificationCount(count, month, db) {
    return toPromise(db.put, db, {
        TableName: MONTH_NOTIFICATION_COUNT_TABLE,
        Item: {
            Month: month,
            Count: count
        }
    });
}

/**
 * Retrieves the Token
 * 
 * @param {object} db The database object 
 */
function fetchToken(db) {
    return toPromise(db.get, db, {
        Key: {
            TokenId: GCAL_TOKEN_ID
        },
        TableName: TOKEN_TABLE
    }).then(response => response.Item.Content);
}

/**
 * Saves the Token
 * 
 * @param {object} token The token 
 * @param {object} db The database object
 */
function saveToken(token, db) {
    return toPromise(db.put, db, {
        TableName: TOKEN_TABLE,
        Item: {
            TokenId: GCAL_TOKEN_ID,
            Content: token
        }
    });
}

/**
 * Authenticates against Google OAuth2
 * 
 * @param {object} credentials 
 * @param {object} token 
 */
function authorize(credentials, token) {
    var auth = new googleAuth();
    var ret = new auth.OAuth2(credentials.clientId, credentials.clientSecret, credentials.redirectUrl);
    ret.setCredentials({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expiry_date: token.expiry_date
    });
    return ret;
}

/**
 * Retrieves a Google Calendar
 * 
 * @param {string} calendarId The calendar to retrieve
 * @param {object} gcal An authenticated Google Calendar API object 
 */
function getCalendar(calendarId, gcal) {
    return toPromise(gcal.calendars.get, gcal.calendars, {
        calendarId: calendarId
    });
}

/**
 * 
 * @param {string} calendarId The calendar to retrieve events for
 * @param {string} start The timeMin, in ISOString format
 * @param {string} end The timeMax, in ISOString format
 * @param {object} gcal An authenticated Google Calendar API object
 */
function listEvents(calendarId, start, end, gcal) {
    return toPromise(gcal.events.list, gcal.events, {
        calendarId: calendarId,
        timeMin: start,
        timeMax: end,
        singleEvents: true,
        orderBy: 'startTime'
    }).then(function (response) { return response.items; });
}

/**
 * Attempts to send an SMS notification through AWS SNS
 * 
 * @param {string} message The message to send 
 * @param {string} phoneNumber The phone number to send to (only US phone numbers supported)
 * @param {object} sns The AWS.SNS object
 */
function sendNotification(message, phoneNumber, sns) {
    return ((process.env.IS_SMS_ENABLED) ? toPromise(sns.publish, sns, {
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Promotional'
            }
        }
    }) : Promise.resolve()).then(() => `${phoneNumber} -> ${message}`);
}

/**
 * Generates a JavaScript object map of contacts to phone numbers
 * 
 * @param {string} s A newline separated string of key:value pairs 
 */
function parseContacts(s) {
    var ret = {};
    if (typeof s === 'string') {
        s.split('\n').map(line => (typeof line === 'string') ? line.split(':') : null).forEach(kv => {
            if (kv && kv.length > 1) {
                ret[kv[0].trim().toLowerCase()] = toPhoneNumber(kv[1]);
            }
        });
    }
    return ret;
}

function getContacts(calendarId, gcal) {
    return getCalendar(calendarId, gcal).then(calendar => parseContacts(calendar.description));
}

function getTimeZone(calendarId, gcal) {
    return getCalendar(calendarId, gcal).then(calendar => calendar.timeZone);
}

/**
 * Generates a message for an event in a given timeZone, limiting the characters
 * 
 * @param {object} event A Google Calendar event 
 * @param {string} timeZone The timeZone of the Google Calendar
 * @param {number} maxChars The maximum allowed characters in the message 
 */
function toMessage(event, timeZone, maxChars) {
    var start;
    if (event.start.date) {

        /* an all day event */
        start = moment(event.start.date, 'YYYY-MM-DD');
    } else {
        start = moment(event.start.dateTime, moment.ISO_8601);
    }
    if (event.start.timeZone) {
        start.tz(event.start.timeZone);
    } else {
        start.tz(timeZone);
    }

    /* TODO: use templating */
    return ('Reminder: ' + start.format('h:mma') + ' ' + event.summary.replace(NOTIFICATION_REGEX, '').trim()).substr(0, maxChars);
}

/**
 * Generates a string summary
 * 
 * @param {object} log An array of logs 
 */
function toSummary(log) {

    /* TODO: implement */
    return JSON.stringify(log);
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
function sendSummary(summary, recipients, from, subject, ses) {
    if (process.env.IS_EMAIL_ENABLED) {
        return toPromise(ses.sendEmail, ses, {
            Destination: {
                ToAddresses: recipients,
            },
            Message: {
                Body: {
                    Text: {
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

    /* email disabled, just log */
    console.log(summary);
    return Promise.resolve();
}

/**
 * Attempts to parse a phone number from a string
 * 
 * @param {string} s A phone number 
 */
function toPhoneNumber(s) {
    if (typeof s === 'string') {
        var ret = s.replace(/[^0-9]/g, '');
        if (ret.length === 11 && ret.charAt(0) === '1') {
            return `+${ret}`;
        } else if (ret.length === 10) {
            return `+1${ret}`;
        }
    }
    return null;
}

exports.handler = function () {
    verbose('Reading environment variables');
    var calendarId = process.env.CALENDAR_GCAL_ID,
        contactsId = process.env.CONTACTS_GCAL_ID,
        monthlyQuota = parseInt(process.env.SMS_MONTHLY_QUOTA),
        maxChars = parseInt(process.env.SMS_MAX_CHARS),
        recipients = process.env.EMAIL_RECIPIENTS.split(',').map(s => s.trim()),
        from = process.env.EMAIL_FROM,
        subject = process.env.EMAIL_SUBJECT,
        awsConfig = {
            region: process.env.AWS_REGION_ || 'us-east-1',
            accessKeyId: process.env.AWS_ACCESS_KEY_ID_,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_
        },
        dynamodb = new aws.DynamoDB.DocumentClient(awsConfig),
        credentials = {
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            clientId: process.env.GOOGLE_CLIENT_ID,
            redirectUrl: process.env.GOOGLE_REDIRECT_URL
        },
        googleApiVersion = process.env.GOOGLE_API_VERSION || 'v3',
        now = moment(),
        quotaMonth = now.format('YYYY-MM'),
        smsDelta = 0;
    verbose('Fetching token');
    fetchToken(dynamodb)
        .then(token => authorize(credentials, token))
        .then(auth => {
            var gcal = google.calendar({
                version: googleApiVersion,
                auth: auth
            });
            verbose('Getting contacts and timeZone');
            return Promise.all([auth, gcal,
                getContacts(contactsId, gcal),
                getTimeZone(calendarId, gcal)
            ]);
        }).then(results => {
            var auth = results[0],
                gcal = results[1],
                contacts = results[2],
                timeZone = results[3],
                nowTz = now.tz(timeZone),
                ymd = [nowTz.year(), nowTz.month(), nowTz.date()],
                bod = moment.tz(ymd, timeZone).toISOString(),
                eod = moment.tz(ymd.concat([23, 59, 59, 999]), timeZone).toISOString();
            verbose(`contacts(${JSON.stringify(contacts)}), timeZone(${timeZone})`);
            verbose(`now(${now}), nowTz(${nowTz}), bod(${bod}), eod(${eod})`);
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
                asyncLog = [auth, smsStart, `Summary for ${nowTz.toString()}`];
            if (events.length == 0) {
                asyncLog.push('No upcoming events found');
            } else {
                events.forEach(event => {
                    var matches = NOTIFICATION_REGEX.exec(event.summary);
                    if (matches) {
                        var phoneNumber = contacts[matches[1].toLowerCase()],
                            message = toMessage(event, timeZone, maxChars),
                            sns = new aws.SNS(awsConfig);
                        if (phoneNumber && message && ((smsStart + smsDelta) < monthlyQuota)) {

                            /* try to send the notification. if it is successful, increment the count. otherwise log the failure */
                            asyncLog.push(sendNotification(message, phoneNumber, sns).catch(err => {
                                
                                /* we'll remove what was added to try to keep the count accurate */
                                smsDelta--;
                                return `Notification send failure: ${err}`; 
                            }));
                            smsDelta++;
                        } else {
                            asyncLog.push(`Invalid notification parameters: contact(${matches[1]}), phone(${phoneNumber}), message(${message}), monthlyQuotaReached(${(smsStart + smsDelta) >= monthlyQuota})`);
                        }
                    } else {
                        asyncLog.push(`Non-notification event: ${event.summary}`);
                    }
                });
            }

            /* wait for everything to complete, then send the summary. if the count has increased, save the new count */
            return Promise.all(asyncLog);
        }).then(results => {
            var ses = new aws.SES(awsConfig),
                auth = results[0],
                smsStart = results[1],
                log = results.slice(2);
                completion = [
                    auth,
                    sendSummary(toSummary(log), recipients, from, subject, ses).catch(err => `Summary send failure: ${err}`)
                ];
            if (smsDelta > 0) {
                verbose('Saving new count');
                completion.push(saveMonthNotificationCount(smsStart + smsDelta, quotaMonth, dynamodb));
            }
            return Promise.all(completion);
        }).then(results => {
            var auth = results[0];
            
            /* resave the token if an automatic refresh occurred */
            if (auth.credentials.id_token) {
                verbose('Saving refreshed token');
                return saveToken(auth.credentials, dynamodb);
            }
        }).catch(err => { throw err });
};