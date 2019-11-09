import { DynamoDB } from "aws-sdk";

/**
 * This class handles converting between consumer objects and the objects DynamoDB expects 
 */
export abstract class AbstractDatastoreService<ConsumerObject> {

  /**
   * 
   * @param tableName The name of the DynamoDB table
   * @param cfg The application config
   */
  constructor(private tableName: string, private dynamodb: DynamoDB.DocumentClient) { }

  /**
   * Retrieves an item by ID
   * 
   * @param id The ID of the entry
   * @returns a Promise that either resolves with the retrieved object in ConsumerObject form or a rejection
   */
  protected getById(id: string): Promise<ConsumerObject> {
    return this.dynamodb.get({
      Key: this.toKey(id),
      TableName: this.tableName
    })
      .promise()
      .then(response => {
        if (!response || !response.Item) {
          throw new Error(`Received unexpected fetch response from DynamoDB: ${response}`);
        } else {
          return this.toType(response.Item);
        }
      });
  }

  /**
   * Stores an object in ConsumerObject form
   * 
   * @param obj The ConsumerObject to store
   * @returns A Promise that resolves with the saved object
   */
  protected save(obj: ConsumerObject): Promise<ConsumerObject> {
    return this.dynamodb.put({
      TableName: this.tableName,
      Item: this.toItem(obj)
    })
      .promise()
      .then(response => {
        if (!response) {
          throw new Error(`Received unexpected save response from DynamoDB: ${JSON.stringify(response)}`);
        } else {
          return this.toType(response.Attributes || {});
        }
      });
  }

  /**
   * Converts from consumer ID to DynamoDB key
   * 
   * @param id the ID
   * @returns The ID in DynamoDB Key form
   */
  protected abstract toKey(id: string): DynamoDB.DocumentClient.Key;

  /**
   * Converts from DynamoDB object to consumer format
   * 
   * @param item The DynamoDB Item
   * @returns The object in ConsumerObject form
   */
  protected abstract toType(item: DynamoDB.DocumentClient.AttributeMap): ConsumerObject;

  /**
   * Converts from consumer object to DynamoDB object
   * 
   * @param obj The consumer object
   * @returns The DynamoDB Item
   */
  protected abstract toItem(obj: ConsumerObject): DynamoDB.DocumentClient.AttributeMap;
}
