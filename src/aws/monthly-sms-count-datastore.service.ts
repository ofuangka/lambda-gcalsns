
import { DynamoDB } from 'aws-sdk';
import moment from 'moment-timezone';

import { AbstractDatastoreService } from "./abstract-datastore.service";
import { Logger } from '../logger';
import { AppCfg } from '../app-cfg';

const MONTHLY_SMS_COUNT_TABLE = 'MonthNotificationCount',
  MONTH_FORMAT = 'YYYY-MM';

/**
 * A monthly SMS count
 */
interface MonthCountPair {
  month: string;
  count: number;
}
export class MonthlySmsCountDatastoreService extends AbstractDatastoreService<MonthCountPair> {

  private static log = Logger.getLogger('MonthlySmsCountDatastoreService');

  private now = moment();

  constructor(dynamodb: DynamoDB.DocumentClient, private cfg: AppCfg) {
    super(MONTHLY_SMS_COUNT_TABLE, dynamodb);
  }

  protected toKey(id: string): DynamoDB.DocumentClient.Key {
    return { Month: id };
  }

  protected toType(item: DynamoDB.DocumentClient.AttributeMap): MonthCountPair {
    return {
      month: item.Month,
      count: isNaN(parseInt(item.Count)) ? 0 : parseInt(item.Count)
    };
  }

  protected toItem(obj: MonthCountPair): DynamoDB.DocumentClient.AttributeMap {
    return {
      Month: obj.month,
      Count: obj.count
    };
  }

  /**
   * Given a month, gets the count for that month
   */
  private getCountByMonth(month: moment.Moment): Promise<number> {
    return this.getById(month.format(MONTH_FORMAT))
      .then(result => result.count);
  }

  /**
   * Gets the count for the current month
   */
  getCurrentCount(): Promise<number> {
    MonthlySmsCountDatastoreService.log.info('Getting current count...');
    return this.getCountByMonth(this.now);
  }

  /**
   * Saves the count for the provided month
   * @param count The new count
   * @param month The month to save to
   */
  private async updateCountByMonth(count: number, month: moment.Moment): Promise<MonthCountPair> {

    MonthlySmsCountDatastoreService.log.info('Saving updated count...', this.cfg.sms.enabled ? '-Production-' : '-Simulation-');
    MonthlySmsCountDatastoreService.log.verbose(`count: ${count}`);
    MonthlySmsCountDatastoreService.log.verbose(`month: ${month}`);

    let newDbEntry: MonthCountPair = {
      month: month.format(MONTH_FORMAT),
      count: count
    };
    if (this.cfg.sms.enabled) {
      return await this.save(newDbEntry);
    }
    return newDbEntry;
  }

  /**
   * Saves the new count into the current month
   * @param newCount The new count for the month
   */
  updateCount(count: number): Promise<MonthCountPair> {
    return this.updateCountByMonth(count, this.now);
  }

}
