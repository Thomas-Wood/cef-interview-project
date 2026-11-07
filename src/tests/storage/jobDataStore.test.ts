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
    ).resolves.toEqual([]);

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

    await expect(
      dataStore.writeJobRecords(records, "Customer A"),
    ).resolves.toEqual([]);

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
    await expect(writePromise).resolves.toEqual([]);
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
    await expect(writePromise).resolves.toEqual([record]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledTimes(6);
  });

  it("logs only the JobIds when a DynamoDB request fails", async () => {
    const dataStore = new JobDataStore("JobsTable");
    const client = jest.mocked(DynamoDBDocumentClient.from).mock.results[0]
      .value;
    const consoleError = jest.spyOn(console, "error").mockImplementation();
    jest.mocked(client.send).mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    await expect(
      dataStore.writeJobRecords([record], "Customer A"),
    ).resolves.toEqual([record]);
    expect(consoleError).toHaveBeenCalledWith(
      "DynamoDB batch write failed",
      { jobIds: ["JOB-123"] },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(record.Name);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(record.Address);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(record.Contact);
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
    ).resolves.toEqual(records.slice(0, 25));

    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("does not send a request for an empty record list", async () => {
    const dataStore = new JobDataStore("JobsTable");

    await expect(
      dataStore.writeJobRecords([], "Customer A"),
    ).resolves.toEqual([]);

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
