import { parse } from "csv/sync";

export const headings = ["JobId", "Name", "Address", "Contact"];

export interface CustomerRecord {
  JobId: string;
  Name: string;
  Address: string;
  Contact?: string;
  [key: string]: unknown;
}

export interface FailedRecord {
  record: unknown;
  errors: string[];
}

export interface RecordValidationResult {
  validRecords: CustomerRecord[];
  failedRecords: FailedRecord[];
}

// This function parses and validate the records in the csv file
export function validateAndParseCSV(
  fileContents: Buffer,
): RecordValidationResult {
  return validateRecords(parseCSVFile(fileContents));
}

// Confirms all the data is correct, formatting and addressing data where possible or rejecting it if not.
export function validateRecords(
  records: readonly unknown[],
): RecordValidationResult {
  const validRecords: CustomerRecord[] = [];
  const failedRecords: FailedRecord[] = [];
  const seenJobIds = new Set<string>();

  for (const record of records) {
    const errors: string[] = [];

    if (!isRecord(record)) {
      failedRecords.push({
        record,
        errors: ["Record must be an object"],
      });
      continue;
    }

    const fields = record;
    const rawJobId = fields.JobId;
    let jobId = "";
    let name = "";
    let address = "";
    let contact: string | undefined;

    // JobId checks
    if (rawJobId === null || rawJobId === undefined) {
      errors.push("JobId is required");
    } else {
      jobId = typeof rawJobId === "string" ? rawJobId : String(rawJobId);
      if (seenJobIds.has(jobId)) {
        errors.push(`Duplicate JobId: ${jobId}`);
      } else {
        seenJobIds.add(jobId);
      }
    }

    // Name check
    if (typeof fields.Name === "string") {
      name = fields.Name;
    } else {
      errors.push("Name must be a non-null string");
    }

    // Address check
    if (typeof fields.Address === "string") {
      address = fields.Address;
    } else {
      errors.push("Address must be a non-null string");
    }

    // Contact check
    if (Object.hasOwn(fields, "Contact")) {
      if (fields.Contact === null) {
        contact = "";
      } else if (typeof fields.Contact === "string") {
        contact = fields.Contact;
      } else if (typeof fields.Contact === "number") {
        contact = String(fields.Contact);
      } else {
        errors.push("Contact must be a string when provided");
      }
    }

    // Fail the record if there was any errors
    if (errors.length > 0) {
      failedRecords.push({ record, errors });
      continue;
    }

    // Push the good records
    validRecords.push({
      ...fields,
      JobId: jobId,
      Name: name,
      Address: address,
      ...(contact !== undefined ? { Contact: contact } : {}),
    });
  }

  console.info("Validation complete", {
    validCount: validRecords.length,
    failedCount: failedRecords.length,
  });

  return { validRecords, failedRecords };
}

// This function parses the data and sets consistent headers
export function parseCSVFile(
  fileContents: Buffer,
): Array<Record<string, string>> {
  const csvString = fileContents
    .toString("utf-8")
    .replace(/\r\n|\r|\n/g, "\r\n");
  const records = parse<Record<string, string>>(csvString, {
    columns: headings,
    from_line: 2,
  });
  console.log("Parsed file with ", records.length, "records");
  return records;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
