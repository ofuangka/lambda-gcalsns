# lambda-gcalsns
Reads Google Calendar event notifications and sends corresponding SNS notifications

## Prerequisites
* Google account
  * Google API configuration
  * Google Calendar configuration
  * Google Sheets configuration
* AWS account
  * IAM configuration
  * SNS configuration
  * SES configuration
  * DynamoDB configuration
  * Cloudwatch configuration
  * Lambda configuration

## Google configuration
In order for programmatic access to Google Calendar and Google Sheets, you need to create a Google Cloud platform project to associate authentication information to. Navigate to https://console.cloud.google.com. Choose to create a new project (e.g. GcalSNS).

Once the project is created, you can navigate to the APIs and Services 
## IAM configuration
In AWS, it is generally poor practice to do everything using your root credentials, so this section describes how to create the necessary Users, Groups and assign the correct Permissions to them to be able to run the application. At a high level, there are 2 principals that will be performing actions requiring AWS permissions. The AWS CLI (command line interface) tool and the Lambda function. They will both be interacting with protected resources, including SNS (text messages), SES (emails), DynamoDB (persistent storage), Cloudwatch (logging) and Lambda.

### CLI
1. Log into the AWS console and navigate to the IAM section > Users section. Choose to create a new User and name it CLI. Select to give it programmatic access. Choose to attach the following policies directly:
  * AmazonDynamoDBFullAccess
  * AmazonSESFullAccess
  * AmazonSNSFullAccess
  * AWSLambdaFullAccess
  * CloudWatchEventsFullAccess
  * CloudWatchLogsFullAccess

2. Leave the remaining options at their defaults and at the confirmation screen, make sure that you copy the Access key ID and _Secret access key_. *This is the only time you will be able to copy the secret access key, so if you forget, you will have to recreate the user.*

### Lambda
1. Back in the AWS console, navigate to IAM > Roles > Create role. Choose Lambda for the AWS service, and add the following policies to the role:
  * AmazonDynamoDBFullAccess
  * AmazonSESFullAccess
  * AmazonSNSFullAccess
  * AWSLambdaBasicExecutionRole
2. Choose default options and name the role "GcalSNS". Provide an appropriate description, e.g. "Allows access to resources necessary for GcalSNS."
3. Once the role has been created, it should appear in the list of roles. Click the role to view it, and copy the value under "Role ARN". This is the identifier for the role, which will be needed in a later step. It should look something like "arn:aws:iam::XXXXXXXXXX:role/GcalSNS".

### Configuration script
1. Install the [AWS cli tool](https://aws.amazon.com/cli/).
2. Open up a terminal window and enter `aws configure`. You'll be prompted for the Access key ID and Secret access key from earlier. For the region, choose the nearest AWS region to your geographical location (`us-east-1`). Choose `json` as your output format.
3. You should now be able to use the AWS CLI to set up the persistent data structures needed to run GcalSNS. Run the following command from the application source root: `./scripts/configure-aws PRIMARY_EMAIL ROLE_ARN`, where the PRIMARY_EMAIL is the email that will be used as the sender for emails, and ROLE_ARN is the ARN obtained when creating the Role earlier.

* Clone the repo and run npm install

```bash
git clone https://github.com/ofuangka/lambda-gcalsns.git
cd lambda-gcalsns
npm install
```

* Run the build/deploy script

```bash
npm start
```

## Configuration
All environment variables declared in AWS are parsed as strings by NodeJS during handler execution. Numeric values must be parseable via parseInt, and boolean values are either present or not (i.e. if IS\_VERBOSE is present and set to the string value `"false"`, it will be considered `true` by the application). Multivalued variables are comma-separated with whitespace trimmed.

| Environment variable       | Type    | Description                                                                                                                                       | Default value (if applicable) | Example value |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------- |
| IS\_VERBOSE                | boolean | If present, enables additional logging for debugging (may contain sensitive information)                                                          | N/A (unset)                   | true          |
| IS\_EMAIL\_ENABLED         | boolean | If present, enables the sending of email messages through Amazon SES, otherwise email sending is simulated                                        | N/A (unset)                   | true          |
| EMAIL\_FROM                | string  | The from address to be used when sending emails                                                                                                   | do-not-reply@domain.com       |               |
| EMAIL\_SUBJECT             | string  | The subject to be used when sending emails                                                                                                        | SMS Notifications             |               |
| EMAIL\_RECIPIENTS          | string  | Comma separated email addresses to receive the summary email (blank or unset values result in no emails)                                          | N/A (unset)                   | email1@domain.com, email2@domain.com |
| IS\_SMS\_ENABLED           | boolean | If present, enables SMS through Amazon SNS, otherwise SMS sending is simulated                                                                    | N/A (unset)                   | true          |
| SMS\_REPLY\_TO             | string  | SMS template variable to indicate who the SMS recipient should reply to                                                                           | (empty string)                | John Admin    |
| SMS\_MONTHLY\_QUOTA        | number  | A max value of SMS that can be sent per month. If the SMSs meets this value, SMS will no longer be sent until the next month                      | 100                           |               |
| SMS\_MAX\_CHARS            | number  | The maxiumum number of characters for an SMS. Amazon will split a long SMS message into multiple messages, which affects the SMS total count/cost | 140                           |               |
| FRIENDLY\_DATE\_FORMAT     | string  | A [MomentJS format](https://momentjs.com/docs/#/parsing/string-format/) to use to format date values within SMS messages                          | ddd, MMM Do                   |               |
| FRIENDLY\_TIME\_FORMAT     | string  | A [MomentJS format](https://momentjs.com/docs/#/parsing/string-format/) to use when formatting time values within SMS messages                    | h:mma                         |               |
| SMS\_MESSAGE\_TMPL         | string  | A template string to use as the SMS content. Template variables are indicated with {{ variable }}                                                 | This message is to confirm {{ eventSummary }} on {{ date }} at {{ time }} for {{ recipientName }}. Please confirm by texting {{ smsReplyTo }} directly. ||
| AWS\_REGION\_              | string  | The AWS region to use for AWS services (DynamoDB, SES, SMS)                                                                                       | (empty string)                | us-east-1     |
| AWS\_ACCESS\_KEY\_ID\_     | string  | The AWS access key ID for the account on which AWS services will be used                                                                          | (empty string)                |               |
| AWS\_SECRET\_ACCESS\_KEY\_ | string  | The AWS secret access key for the account on which AWS services will be used                                                                      | (empty string)                |               | 
| CALENDAR\_GCAL\_ID         | string  | The Google Calendar ID of the calendar containing events                                                                                          | (empty string)                |               |
| GOOGLE\_CLIENT\_SECRET     | string  | The Google API OAuth2 client secret                                                                                                               | (empty string)                |               |
| GOOGLE\_CLIENT\_ID         | string  | The Google API OAuth2 client id                                                                                                                   | (empty string)                |               |
| GOOGLE\_REDIRECT\_URL      | string  | The Google API OAuth2 redirect URL                                                                                                                | (empty string)                |               |
| CONTACTS\_SHEETS\_ID       | string  | The Google Sheets ID for the sheet containing contact information                                                                                 | (empty string)                |               |
