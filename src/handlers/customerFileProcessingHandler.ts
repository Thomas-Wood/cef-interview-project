import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  validateAndParseCSV,
  type CustomerRecord,
} from "../dataValidation/customerCSVValidation";
import { JobDataStore } from "../storage/jobDataStore";

interface S3ObjectRecord {
  eventSource: "aws:s3";
  s3: {
    bucket: { name: string };
    object: { key: string };
  };
}

const s3Client = new S3Client({});

export async function handler(event: unknown): Promise<void> {
  let records: S3ObjectRecord[];

  // Check the event is an S3 event (so a test event from the Lambda console doesn't trigger an error)
  try {
    records = parseS3Records(event);
  } catch (error) {
    console.warn("Ignoring invocation: Not a valid S3 event", error);
    return;
  }

  const tableName = process.env.JOBS_TABLE_NAME;
  if (!tableName) {
    throw new Error("JOBS_TABLE_NAME environment variable is required");
  }
  const jobDataStore = new JobDataStore(tableName);
  const failedStorageRecords: CustomerRecord[] = [];

  // Process each event record if multiple files were uploaded at once.
  for (const record of records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " ")); // Regex replaces "+" with " ".

    // Check file type is csv
    if (!key.toLowerCase().endsWith(".csv")) {
      console.error("Invalid file: Not a CSV file", { bucket, key });
      continue;
    }

    // Get customer name from file name
    const customerName = key
      .split("/")
      .pop()
      ?.replace(/\.csv$/i, ""); // Remove .csv from the end
    if (!customerName) {
      throw new Error(`Could not determine customer name from S3 key: ${key}`);
    }

    // Get the file
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(
        `S3 returned an empty response body for s3://${bucket}/${key}`,
      );
    }
    const fileContents = Buffer.from(
      await response.Body.transformToByteArray(),
    );
    console.info("File retrieved", {
      bucket,
      key,
      byteLength: fileContents.byteLength,
    });

    // Validate and parse the file contents
    const recordValidationResult = validateAndParseCSV(fileContents);

    // Log failed records together
    if (recordValidationResult.failedRecords.length > 0) {
      console.warn(
        "Skipping invalid customer records",
        recordValidationResult.failedRecords,
      );
    }

    // Store valid records and keep track of any the database could not write.
    const recordsNotWritten = await jobDataStore.writeJobRecords(
      recordValidationResult.validRecords,
      customerName,
    );
    failedStorageRecords.push(...recordsNotWritten);

    if (failedStorageRecords.length > 0) {
      console.error("Some DynamoDB records were not written:", {
        records: failedStorageRecords,
      });
    }
  }
}

// Checks the event is valid and returns just the useful information
function parseS3Records(event: unknown): S3ObjectRecord[] {
  if (
    !isRecord(event) ||
    !Array.isArray(event.Records) ||
    event.Records.length === 0
  ) {
    throw new Error("Invocation does not contain S3 event records");
  }

  return event.Records.map((record: unknown): S3ObjectRecord => {
    if (
      !isRecord(record) ||
      record.eventSource !== "aws:s3" ||
      !isRecord(record.s3)
    ) {
      throw new Error("Invocation contains a non-S3 event record");
    }

    const bucket = record.s3.bucket;
    const object = record.s3.object;
    if (
      !isRecord(bucket) ||
      typeof bucket.name !== "string" ||
      !isRecord(object) ||
      typeof object.key !== "string"
    ) {
      throw new Error("S3 event record is missing its bucket or object key");
    }

    return {
      eventSource: "aws:s3",
      s3: {
        bucket: { name: bucket.name },
        object: { key: object.key },
      },
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
