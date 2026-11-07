import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { JobDataStore } from "../../storage/jobDataStore";

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: jest.fn().mockResolvedValue({}),
    })),
  },
  BatchWriteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe("JobDataStore", () => {
  const record = {
    JobId: "JOB-123",
    Name: "Adam",
    Address: "London",
    Contact: "adam@example.com",
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("batch writes record fields with the customer name to DynamoDB", async () => {
    const dataStore = new JobDataStore("JobsTable");
    const records = [record, { ...record, JobId: "JOB-456" }];

    await expect(
      dataStore.writeJobRecords(records, "Customer A"),
    ).resolves.toBeUndefined();

    const expectedRequest = {
      RequestItems: {
        JobsTable: records.map((item) => ({
          PutRequest: {
            Item: {
              ...item,
              customerName: "Customer A",
            },
          },
        })),
      },
    };
    expect(BatchWriteCommand).toHaveBeenCalledWith(expectedRequest);

    const client = jest.mocked(DynamoDBDocumentClient.from).mock.results[0]
      .value;
    expect(client.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expectedRequest,
      }),
    );
  });

  it("splits records into batches of at most 25", async () => {
    const dataStore = new JobDataStore("JobsTable");
    const records = Array.from({ length: 26 }, (_, index) => ({
      ...record,
      JobId: `JOB-${index}`,
    }));

    await dataStore.writeJobRecords(records, "Customer A");

    const requests = jest.mocked(BatchWriteCommand).mock.calls;
    expect(requests).toHaveLength(2);
    expect(requests[0][0].RequestItems?.JobsTable).toHaveLength(25);
    expect(requests[1][0].RequestItems?.JobsTable).toHaveLength(1);
  });

  it("retries unprocessed items", async () => {
    jest.useFakeTimers();
    const dataStore = new JobDataStore("JobsTable");
    const client = jest.mocked(DynamoDBDocumentClient.from).mock.results[0]
      .value;
    const unprocessedItem = {
      PutRequest: { Item: { ...record, customerName: "Customer A" } },
    };
    jest
      .mocked(client.send)
      .mockResolvedValueOnce({ UnprocessedItems: { JobsTable: [unprocessedItem] } })
      .mockResolvedValueOnce({});

    const writePromise = dataStore.writeJobRecords([record], "Customer A");
    await jest.advanceTimersByTimeAsync(50);
    await expect(writePromise).resolves.toBeUndefined();
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("logs unprocessed records after exhausting retries", async () => {
    jest.useFakeTimers();
    const dataStore = new JobDataStore("JobsTable");
    const client = jest.mocked(DynamoDBDocumentClient.from).mock.results[0]
      .value;
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    const unprocessedItems = {
      JobsTable: [
        { PutRequest: { Item: { ...record, customerName: "Customer A" } } },
      ],
    };
    jest.mocked(client.send).mockResolvedValue({ UnprocessedItems: unprocessedItems });

    const writePromise = dataStore.writeJobRecords([record], "Customer A");
    await jest.runAllTimersAsync();
    await expect(writePromise).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "Some DynamoDB records were not written:",
      expect.objectContaining({ records: [record] }),
    );
    expect(client.send).toHaveBeenCalledTimes(6);
  });

  it("logs the DynamoDB error and all records not handled", async () => {
    const dataStore = new JobDataStore("JobsTable");
    const client = jest.mocked(DynamoDBDocumentClient.from).mock.results[0]
      .value;
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    const requestError = new Error("DynamoDB unavailable");
    jest.mocked(client.send).mockRejectedValueOnce(requestError);

    await expect(
      dataStore.writeJobRecords([record], "Customer A"),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "DynamoDB batch write failed",
      expect.objectContaining({ error: requestError }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Some DynamoDB records were not written:",
      expect.objectContaining({ records: [record] }),
    );
  });

  it("continues with later batches after a request error and logs failures together", async () => {
    const dataStore = new JobDataStore("JobsTable");
    const client = jest.mocked(DynamoDBDocumentClient.from).mock.results[0]
      .value;
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    const records = Array.from({ length: 26 }, (_, index) => ({
      ...record,
      JobId: `JOB-${index}`,
    }));
    jest
      .mocked(client.send)
      .mockRejectedValueOnce(new Error("DynamoDB unavailable"))
      .mockResolvedValueOnce({});

    await expect(
      dataStore.writeJobRecords(records, "Customer A"),
    ).resolves.toBeUndefined();

    expect(client.send).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(
      "Some DynamoDB records were not written:",
      expect.objectContaining({ records: records.slice(0, 25) }),
    );
  });

  it("does not send a request for an empty record list", async () => {
    const dataStore = new JobDataStore("JobsTable");

    await expect(
      dataStore.writeJobRecords([], "Customer A"),
    ).resolves.toBeUndefined();

    const client = jest.mocked(DynamoDBDocumentClient.from).mock.results[0]
      .value;
    expect(client.send).not.toHaveBeenCalled();
  });

  it("requires a table name when initialized", () => {
    expect(() => new JobDataStore("")).toThrow(
      "A DynamoDB table name is required",
    );
  });
});
