
import { DynamoDB } from 'aws-sdk';
import moment from 'moment-timezone';

import { AbstractDatastoreService } from "./abstract-datastore.service";
import { Logger } from '../util/logger';
import { AppContext } from '../app-ctx';

const MONTHLY_SMS_COUNT_TABLE = 'SmsCount',
  MONTH_FORMAT = 'YYYY-MM';

interface MonthCountPair {
  Month: string;
  Count: number;
}

/**
 * Datastore for the monthly SMS count
 */
export class MonthlySmsCountDatastoreService extends AbstractDatastoreService<MonthCountPair> {

  private static ID = 'MonthlySmsCountDatastoreService';

  private log: Logger;

  constructor(dynamodb: DynamoDB.DocumentClient, private appContext: AppContext) {
    super(MONTHLY_SMS_COUNT_TABLE, dynamodb);
    this.log = appContext.getLogger(MonthlySmsCountDatastoreService.ID);
  }

  protected toKey(id: string): DynamoDB.DocumentClient.Key {
    return { Month: id };
  }

  protected toType(item: DynamoDB.DocumentClient.AttributeMap): MonthCountPair {
    return {
      Month: item.Month,
      Count: isNaN(parseInt(item.Count)) ? 0 : parseInt(item.Count)
    };
  }

  protected toItem(obj: MonthCountPair): DynamoDB.DocumentClient.AttributeMap {
    return {
      Month: obj.Month,
      Count: obj.Count
    };
  }

  /**
   * Given a month, gets the count for that month
   * 
   * @param month The month to retrieve
   * 
   * @returns A promise resolving to the SMS count for that month
   */
  private getCountByMonth(month: moment.Moment): Promise<number> {
    return this.getById(month.format(MONTH_FORMAT))
      .then(result => result.Count)
      .catch(err => {
        this.log.error('An error occurred when retrieving the count, substituting 0', err);
        return 0;
      });
  }

  /**
   * Gets the count for the current month
   * 
   * @returns A promise resolving to the SMS count for the current month
   */
  getCurrentCount(): Promise<number> {
    this.log.info('Getting current count...');
    return this.getCountByMonth(this.appContext.appStart);
  }

  /**
   * Saves the count for the provided month
   * 
   * @param count The new count
   * @param month The month to save to
   * 
   * @returns A promise resolving to the count/month pair
   */
  private async updateCountByMonth(count: number, month: moment.Moment): Promise<MonthCountPair> {
    let newDbEntry: MonthCountPair = {
      Month: month.format(MONTH_FORMAT),
      Count: count
    };
    if (!this.appContext.config.sms.enabled) {
      this.log.info('No need to save updated count when SMS is disabled.');
      return newDbEntry;
    } else {
      this.log.info(`Saving updated count ${count} for ${month}...`);
      try {
        return this.save(newDbEntry);
      } catch (err) {
        this.log.error(`Error thrown when updating SMS count.`);
        throw err;
      }
    }
  }

  /**
   * Saves the new count into the current month
   * @param newCount The new count for the month
   * 
   * @returns A promise resolving to the count/month pair
   */
  public updateCount(count: number): Promise<MonthCountPair> {
    return this.updateCountByMonth(count, this.appContext.appStart);
  }

}
