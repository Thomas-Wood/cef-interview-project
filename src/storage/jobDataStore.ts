import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  type BatchWriteWriteRequest,
} from "@aws-sdk/lib-dynamodb";
import type { CustomerRecord } from "../dataValidation/customerCSVValidation";

const MAX_BATCH_SIZE = 25;
const MAX_RETRIES = 5;

export class JobDataStore {
  private readonly dynamoDb: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
    if (!tableName) {
      throw new Error("A DynamoDB table name is required");
    }
    this.dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  // Writes all records to the DB and returns any records that could not be stored.
  async writeJobRecords(
    records: readonly CustomerRecord[],
    customerName: string,
  ): Promise<CustomerRecord[]> {
    const failedRecords: CustomerRecord[] = [];

    // Loop over each chunk of records
    for (let offset = 0; offset < records.length; offset += MAX_BATCH_SIZE) {
      const batch = records.slice(offset, offset + MAX_BATCH_SIZE);
      let pendingRecords = batch;
      // Prep all requests
      let pendingRequests: BatchWriteWriteRequest[] = pendingRecords.map(
        (record) => ({
          PutRequest: {
            Item: {
              ...record,
              customerName,
            },
          },
        }),
      );
      let retryCount = 0;

      // Send the next batch, waiting for a response after each (avoids overloading the API for very large files).
      while (pendingRequests.length > 0) {
        let response;
        try {
          response = await this.dynamoDb.send(
            new BatchWriteCommand({
              RequestItems: {
                [this.tableName]: pendingRequests,
              },
            }),
          );
        } catch {
          console.error("DynamoDB batch write failed", {
            jobIds: pendingRecords.map(({ JobId }) => JobId),
          });
          failedRecords.push(...pendingRecords);
          break;
        }

        // Handle any unprocessed records DynamoDB returned
        const unprocessedRequests =
          response.UnprocessedItems?.[this.tableName] ?? [];
        if (unprocessedRequests.length > 0) {
          const unprocessedJobIds = new Set(
            unprocessedRequests
              .map((request) => request.PutRequest?.Item?.JobId)
              .filter((jobId): jobId is string => typeof jobId === "string"),
          );
          // Filter the list of records to only those that were not processed, so we can retry them
          pendingRecords = pendingRecords.filter((record) =>
            unprocessedJobIds.has(record.JobId),
          );
          pendingRequests = unprocessedRequests;
        } else {
          // No unprocessed records, so pending lists of reset. This drops us out of the loop
          pendingRecords = [];
          pendingRequests = [];
        }

        if (pendingRequests.length > 0) {
          if (retryCount >= MAX_RETRIES) {
            failedRecords.push(...pendingRecords);
            break;
          }

          await new Promise((resolve) =>
            setTimeout(resolve, 50 * 2 ** retryCount),
          );
          retryCount += 1;
        }
      }
    }

    return failedRecords;
  }
}
