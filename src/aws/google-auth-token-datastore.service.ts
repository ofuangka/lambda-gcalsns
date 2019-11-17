
import { DynamoDB } from "aws-sdk";

import { AbstractDatastoreService } from "./abstract-datastore.service";
import { Logger } from "../util/logger";
import { AppContext } from "../app-ctx";

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

  private log: Logger;

  constructor(dynamodb: DynamoDB.DocumentClient, context: AppContext) {
    super(TOKEN_TABLE, dynamodb);
    this.log = context.getLogger('GoogleAuthTokenDatastoreService');
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
    this.log.info(`Retrieving GoogleAuthToken...`);
    return this.getById(GOOGLE_AUTH_TOKEN_ID);
  }

  /**
   * Saves the token into the datastore
   * @param token The google auth token
   */
  saveToken(token: GoogleAuthToken): Promise<GoogleAuthToken> {
    this.log.info(`Saving GoogleAuthToken...`);
    return this.save(token);
  }
}
