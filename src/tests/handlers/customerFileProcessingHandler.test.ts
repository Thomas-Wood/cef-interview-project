import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { validateAndParseCSV } from "../../dataValidation/customerCSVValidation";
import { handler } from "../../handlers/customerFileProcessingHandler";
import { JobDataStore } from "../../storage/jobDataStore";

jest.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
}));

jest.mock("../../dataValidation/customerCSVValidation", () => ({
  validateAndParseCSV: jest.fn(),
}));

jest.mock("../../storage/jobDataStore", () => ({
  JobDataStore: jest.fn().mockImplementation(() => ({
    writeJobRecords: jest.fn().mockResolvedValue([]),
  })),
}));

describe("customer file processing handler", () => {
  const originalTableName = process.env.JOBS_TABLE_NAME;
  const s3Send = jest.mocked(S3Client).mock.results[0].value.send;
  const validRecord = {
    JobId: "JOB-123",
    Name: "Ada",
    Address: "London",
  };
  const failedRecord = {
    record: { JobId: null },
    errors: ["JobId is required"],
  };

  function s3Event(key = "CustomerA.csv") {
    return {
      Records: [
        {
          eventSource: "aws:s3",
          s3: {
            bucket: { name: "customer-files" },
            object: { key },
          },
        },
      ],
    };
  }

  async function expectInvalidS3EventIgnored(event: unknown) {
    const warn = jest.spyOn(console, "warn").mockImplementation();

    await expect(handler(event)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      "Ignoring invocation: Not a valid S3 event",
      expect.any(Error),
    );
    expect(s3Send).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    process.env.JOBS_TABLE_NAME = "JobsTable";
    s3Send.mockResolvedValue({
      Body: {
        transformToByteArray: jest.fn().mockResolvedValue(Buffer.from("csv")),
      },
    });
    jest.mocked(validateAndParseCSV).mockReturnValue({
      validRecords: [validRecord],
      failedRecords: [failedRecord],
    });
  });

  afterEach(() => {
    if (originalTableName === undefined) {
      delete process.env.JOBS_TABLE_NAME;
    } else {
      process.env.JOBS_TABLE_NAME = originalTableName;
    }
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("ignores a null event", async () => {
    await expectInvalidS3EventIgnored(null);
  });

  it("ignores an event without a Records field", async () => {
    await expectInvalidS3EventIgnored({});
  });

  it("ignores an event with no S3 records", async () => {
    await expectInvalidS3EventIgnored({ Records: [] });
  });

  it("ignores a null event record", async () => {
    await expectInvalidS3EventIgnored({ Records: [null] });
  });

  it("ignores a record from a non-S3 event source", async () => {
    await expectInvalidS3EventIgnored({
      Records: [{ eventSource: "aws:sqs", s3: {} }],
    });
  });

  it("ignores a record with no S3 data", async () => {
    await expectInvalidS3EventIgnored({
      Records: [{ eventSource: "aws:s3", s3: null }],
    });
  });

  it("ignores a record with no bucket data", async () => {
    await expectInvalidS3EventIgnored({
      Records: [{ eventSource: "aws:s3", s3: { bucket: null } }],
    });
  });

  it("ignores a record with a non-string bucket name", async () => {
    await expectInvalidS3EventIgnored({
      Records: [
        { eventSource: "aws:s3", s3: { bucket: { name: 1 }, object: {} } },
      ],
    });
  });

  it("ignores a record with no object data", async () => {
    await expectInvalidS3EventIgnored({
      Records: [
        {
          eventSource: "aws:s3",
          s3: { bucket: { name: "bucket" }, object: null },
        },
      ],
    });
  });

  it("ignores a record with a non-string object key", async () => {
    await expectInvalidS3EventIgnored({
      Records: [
        {
          eventSource: "aws:s3",
          s3: { bucket: { name: "bucket" }, object: { key: 1 } },
        },
      ],
    });
  });

  it("throws if the table name environment variable is missing", async () => {
    delete process.env.JOBS_TABLE_NAME;

    await expect(handler(s3Event())).rejects.toThrow(
      "JOBS_TABLE_NAME environment variable is required",
    );
  });

  it("throws if S3 returns no object body", async () => {
    s3Send.mockResolvedValueOnce({});

    await expect(handler(s3Event())).rejects.toThrow(
      "S3 returned an empty response body for s3://customer-files/CustomerA.csv",
    );
  });

  it("logs and ignores files that are not CSVs", async () => {
    const error = jest.spyOn(console, "error").mockImplementation();

    await expect(handler(s3Event("CustomerA.txt"))).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith("Invalid file: Not a CSV file", {
      bucket: "customer-files",
      key: "CustomerA.txt",
    });
    expect(validateAndParseCSV).not.toHaveBeenCalled();
  });

  it("continues processing CSV files after a non-CSV event record", async () => {
    const error = jest.spyOn(console, "error").mockImplementation();
    const event = s3Event("CustomerA.txt");
    event.Records.push(
      s3Event("CustomerB.csv").Records[0],
    );

    await expect(handler(event)).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith("Invalid file: Not a CSV file", {
      bucket: "customer-files",
      key: "CustomerA.txt",
    });
    expect(s3Send).toHaveBeenCalledTimes(1);
    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "customer-files",
      Key: "CustomerB.csv",
    });
    const dataStore = jest.mocked(JobDataStore).mock.results[0].value;
    expect(dataStore.writeJobRecords).toHaveBeenCalledWith(
      [validRecord],
      "CustomerB",
    );
  });

  it("processes CSV files with an uppercase extension", async () => {
    await expect(handler(s3Event("CustomerA.CSV"))).resolves.toBeUndefined();

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "customer-files",
      Key: "CustomerA.CSV",
    });
    const dataStore = jest.mocked(JobDataStore).mock.results[0].value;
    expect(dataStore.writeJobRecords).toHaveBeenCalledWith(
      [validRecord],
      "CustomerA",
    );
  });

  // Main hapy path test
  it("validates and stores valid records using the decoded customer filename", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation();
    const info = jest.spyOn(console, "info").mockImplementation();

    await expect(
      handler(s3Event("folder/Customer+A.csv")),
    ).resolves.toBeUndefined();

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: "customer-files",
      Key: "folder/Customer A.csv",
    });
    expect(validateAndParseCSV).toHaveBeenCalledWith(Buffer.from("csv"));
    expect(JobDataStore).toHaveBeenCalledWith("JobsTable");
    const dataStore = jest.mocked(JobDataStore).mock.results[0].value;
    expect(dataStore.writeJobRecords).toHaveBeenCalledWith(
      [validRecord],
      "Customer A",
    );
    expect(warn).toHaveBeenCalledWith("Skipping invalid customer records", [
      failedRecord,
    ]);
    expect(info).toHaveBeenCalledWith("File retrieved", {
      bucket: "customer-files",
      key: "folder/Customer A.csv",
      byteLength: 3,
    });
  });

  it("does not log failed records when all records are valid", async () => {
    jest.mocked(validateAndParseCSV).mockReturnValue({
      validRecords: [validRecord],
      failedRecords: [],
    });
    const warn = jest.spyOn(console, "warn").mockImplementation();

    await handler(s3Event());

    expect(warn).not.toHaveBeenCalled();
  });

  it("logs storage failures once after processing the file", async () => {
    const failedStorageRecord = {
      JobId: "JOB-FAILED",
      Name: "Grace",
      Address: "Cambridge",
    };
    const writeJobRecords = jest.fn().mockResolvedValue([failedStorageRecord]);
    jest
      .mocked(JobDataStore)
      .mockImplementationOnce(
        () => ({ writeJobRecords }) as unknown as JobDataStore,
      );
    const error = jest.spyOn(console, "error").mockImplementation();

    await handler(s3Event());

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "Some DynamoDB records were not written:",
      { records: [failedStorageRecord] },
    );
  });

  it("throws if the CSV key does not identify a customer filename", async () => {
    await expect(handler(s3Event(".csv"))).rejects.toThrow(
      "Could not determine customer name from S3 key: .csv",
    );
  });
});
