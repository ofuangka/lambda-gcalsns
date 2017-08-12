var aws = require('aws-sdk'),
    google = require('googleapis'),
    googleAuth = require('google-auth-library'),
    moment = require('moment-timezone');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'],
    NOTIFICATION_REGEX = /\*([^\*]+)\*/,
    MONTH_NOTIFICATION_COUNT_TABLE = 'MonthNotificationCount',
    TOKEN_TABLE = 'Token',
    GCAL_TOKEN_ID = 'gcalsns-google';

function toPromise(fn, context) {
    return new Promise((resolve, reject) => {
        var args = (arguments.length === 1 ? [arguments[0]] : Array.apply(null, arguments));
        fn.apply(context, args.slice(2).concat((err, response) => {
            if (err) {
                reject(err);
            } else {
                resolve(response);
            }
        }));
    });
}

function verbose(message) {
    if (process.env.IS_VERBOSE) {
        console.log(message);
    }
}

function fetchMonthNotificationCount(month, db) {
    return toPromise(db.get, db, {
        Key: {
            Month: month
        },
        TableName: MONTH_NOTIFICATION_COUNT_TABLE
    }).then(response => (response.Item) ? response.Item.Count : 0);
}

function saveMonthNotificationCount(count, month, db) {
    return toPromise(db.put, db, {
        TableName: MONTH_NOTIFICATION_COUNT_TABLE,
        Item: {
            Month: month,
            Count: count
        }
    });
}

function fetchToken(db) {
    return toPromise(db.get, db, {
        Key: {
            TokenId: GCAL_TOKEN_ID
        },
        TableName: TOKEN_TABLE
    }).then(response => response.Item.Content);
}

function saveToken(token, db) {
    return toPromise(db.put, db, {
        TableName: TOKEN_TABLE,
        Item: {
            TokenId: GCAL_TOKEN_ID,
            Content: token
        }
    });
}

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

function getCalendar(calendarId, gcal) {
    return toPromise(gcal.calendars.get, gcal.calendars, {
        calendarId: calendarId
    });
}

function listEvents(calendarId, start, end, gcal) {
    return toPromise(gcal.events.list, gcal.events, {
        calendarId: calendarId,
        timeMin: start,
        timeMax: end,
        singleEvents: true,
        orderBy: 'startTime'
    }).then(function (response) { return response.items; });
}

function sendNotification(message, phoneNumber, sns) {
    return ((process.env.IS_SMS_ENABLED) ? toPromise(sns.publish, sns, {
        PhoneNumber: phoneNumber,
        Message: message
    }) : Promise.resolve()).then(_ => `${phoneNumber} -> ${message}`);
}

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

function toMessage(event, maxChars) {
    var start;
    if (event.start.date) {
    
        /* an all day event */
        start = moment(event.start.date, 'YYYY-MM-DD');
    } else {
        start = moment(event.start.dateTime, moment.ISO_8601);
    }
    if (event.start.timeZone) {
        start.tz(event.start.timeZone);
    }

    /* TODO: use templating */
    return ('Reminder: ' + start.format('h:mma') + ' ' + event.summary.replace(NOTIFICATION_REGEX, '').trim()).substr(0, maxChars);
}

function toSummary(log) {

    /* TODO: implement */
    return JSON.stringify(log);
}

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
        now = moment();
    verbose('Fetching token');
    fetchToken(dynamodb).then(token => authorize(credentials, token)).then(auth => {
        var gcal = google.calendar({
            version: googleApiVersion,
            auth: auth
        });
        verbose('Getting contacts and timeZone');
        return Promise.all([
            getContacts(contactsId, gcal), 
            getTimeZone(calendarId, gcal)
        ]).then(results => {
            var contacts = results[0],
                timeZone = results[1],
                nowTz = now.tz(timeZone),
                ymd = [nowTz.year(), nowTz.month(), nowTz.date()],
                bod = moment.tz(ymd, timeZone).toISOString(),
                eod = moment.tz(ymd.concat([23, 59, 59, 999]), timeZone).toISOString();
            verbose(`contacts(${JSON.stringify(contacts)}), timeZone(${timeZone})`);
            verbose(`now(${now}), nowTz(${nowTz}), bod(${bod}), eod(${eod})`);
            return listEvents(calendarId, bod, eod, gcal).then(events => {
                if (events.length == 0) {
                    console.log('No upcoming events found.');
                } else {
                    var quotaMonth = now.format('YYYY-MM');
                    verbose('Fetching count');
                    return fetchMonthNotificationCount(quotaMonth, dynamodb).then(startCount => {
                        var newCount = startCount,
                            asyncLog = [`Summary for ${nowTz.format('llll')}`],
                            ses = new aws.SES(awsConfig);
                        events.forEach(event => {
                            var matches = NOTIFICATION_REGEX.exec(event.summary);
                            if (matches) {
                                var phoneNumber = contacts[matches[1].toLowerCase()],
                                    message = toMessage(event, maxChars),
                                    sns = new aws.SNS(awsConfig);
                                if (phoneNumber && message && (newCount < monthlyQuota)) {

                                    /* try to send the notification. if it is successful, increment the count. otherwise log the failure */
                                    asyncLog.push(sendNotification(message, phoneNumber, sns).then(result => {
                                        newCount++;
                                        return result;
                                    }).catch(err => `Notification send failure: ${err}`));
                                } else {
                                    asyncLog.push(`Invalid notification parameters: contact(${matches[1]}), phone(${phoneNumber}), message(${message}), monthlyQuotaReached(${newCount >= monthlyQuota})`);
                                }
                            } else {
                                asyncLog.push(`Non-notification event: ${event.summary}`);
                            }
                        });

                        /* wait for everything to complete, then send the summary. if the count has increased, save the new count */
                        return Promise.all(asyncLog).then(log => sendSummary(toSummary(log), recipients, from, subject, ses)).then(_ => {
                            if (newCount > startCount) {
                                verbose('Saving count');
                                asyncRet.push(saveMonthNotificationCount(newCount, quotaMonth, dynamodb));
                            }
                        });
                    });
                }
            });
        }).then(_ => {

            /* resave the token if a refresh occurred */
            if (auth.credentials.id_token) {
                verbose('Saving token');
                return saveToken(auth.credentials, dynamodb);
            }
        });
    }).catch(err => { throw err });
};