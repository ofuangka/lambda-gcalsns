
import { DynamoDB } from "aws-sdk";

import { AbstractDatastoreService } from "./abstract-datastore.service";
import { Logger } from "../logger";

const TOKEN_TABLE = 'Token',
  GOOGLE_AUTH_TOKEN_ID = 'gcalsns-google';

export interface GoogleAuthToken {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

/**
 * Fetch/store GoogleAccessTokens
 */
export class GoogleAuthTokenDatastoreService extends AbstractDatastoreService<GoogleAuthToken> {

  private static log = Logger.getLogger('GoogleAuthTokenDatastoreService');

  constructor(dynamodb: DynamoDB.DocumentClient) {
    super(TOKEN_TABLE, dynamodb);
  }

  protected toKey(s: string): DynamoDB.DocumentClient.Key {
    return { TokenId: s };
  }

  protected toType(item: DynamoDB.DocumentClient.AttributeMap): GoogleAuthToken {
    return item.Content;
  }

  protected toItem(obj: GoogleAuthToken): DynamoDB.DocumentClient.AttributeMap {
    return { TokenId: GOOGLE_AUTH_TOKEN_ID, Content: obj };
  }

  /**
   * Retrieves the token from the datastore
   */
  getToken(): Promise<GoogleAuthToken> {
    GoogleAuthTokenDatastoreService.log.info(`Retrieving GoogleAuthToken...`);
    return this.getById(GOOGLE_AUTH_TOKEN_ID);
  }

  /**
   * Saves the token into the datastore
   */
  saveToken(token: GoogleAuthToken): Promise<GoogleAuthToken> {
    GoogleAuthTokenDatastoreService.log.info(`Saving GoogleAuthToken...`);
    return this.save(token);
  }
}
