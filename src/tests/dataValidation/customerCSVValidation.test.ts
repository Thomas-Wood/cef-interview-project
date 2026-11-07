import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  headings,
  parseCSVFile,
  validateAndParseCSV,
  validateRecords,
} from "../../dataValidation/customerCSVValidation";

describe("parseCSVFile", () => {
  const fixturesDirectory = join(__dirname, "..", "fixtures", "csvFiles");

  it("defines the canonical CSV headings", () => {
    expect(headings).toEqual(["JobId", "Name", "Address", "Contact"]);
  });

  it("parses Customer1.csv, including quoted commas and escaped quotes", () => {
    const csv = readFileSync(join(fixturesDirectory, "Customer1.csv"));
    const records = parseCSVFile(csv);

    expect(records).toEqual([
      {
        JobId: "JOB-2026-001",
        Name: "Jane Doe",
        Address: "123 High Street, Suite 400, London, EC1A 1BB",
        Contact: "jane.doe@example.com",
      },
      {
        JobId: "REQ#99402",
        Name: "John Smith",
        Address: "Flat 2B, St. John's Wood, London",
        Contact: "+44 7700 900077",
      },
      {
        JobId: "REF-8A3F-2026",
        Name: "O'Connor, Ciaran",
        Address: '45, "The Meadows", Church Lane, Manchester, M1 1AA',
        Contact: "ciaran.oconnor@example.org",
      },
      {
        JobId: "ENG/2026/0401",
        Name: "Taylor, Alex",
        Address: "10 Downing Street, Westminster",
        Contact: "alex.taylor@techcorp.co.uk",
      },
      {
        JobId: "8839201",
        Name: "Dr. Samira Khan",
        Address: "Building A, Innovation Park, Cambridge, CB4 0FZ",
        Contact: "+44 1223 496000, ext 102",
      },
    ]);
  });

  it("parses Customer2.csv, including multiline and quoted fields", () => {
    const csv = readFileSync(join(fixturesDirectory, "Customer2.csv"));
    const records = parseCSVFile(csv);

    expect(records).toEqual([
      {
        JobId: "JOB REF: 2026, REV-A",
        Name: "Chen, Wei",
        Address:
          "100 Innovation Way\r\nFloor 3, Tech Hub\r\nEdinburgh, EH1 1XYZ",
        Contact: "wei.chen@devops-solutions.io",
      },
      {
        JobId: "8839201",
        Name: "Marcus Aurelius",
        Address: '"Appian Way, Villa 4", Rome, Italy',
        Contact: "marcus@classics.org",
      },
      {
        JobId: "2026_DEV_012",
        Name: "Sarah Connor",
        Address: "PO Box 456, Terminus Road, Bristol",
        Contact: "",
      },
      {
        JobId: "job-ref-2026-mia-13",
        Name: 'D\'Souza, Maria "Mia"',
        Address: "88 Queensway, Apt 12B, Birmingham, B1 1AA",
        Contact: "maria.dsouza@enterprise.com",
      },
      {
        JobId: "[JOB]-2026-14",
        Name: "  Liam O'Neill  ",
        Address: "  12 Station Road, Leeds, LS1 2TW  ",
        Contact: "liam.oneill@startup.co",
      },
    ]);
  });

  it("throws when the CSV is malformed", () => {
    const csv = Buffer.from('customerId,name\n123,"Ada\n');

    expect(() => parseCSVFile(csv)).toThrow();
  });
});

describe("validateRecords", () => {
  it("rejects values that are not record objects", () => {
    const records = ["not a record", null, []];

    const result = validateRecords(records);

    expect(result.validRecords).toEqual([]);
    expect(result.failedRecords).toEqual([
      { record: "not a record", errors: ["Record must be an object"] },
      { record: null, errors: ["Record must be an object"] },
      { record: [], errors: ["Record must be an object"] },
    ]);
  });

  it("casts JobId and numeric Contact to strings and normalizes null Contact", () => {
    const result = validateRecords([
      { JobId: 123, Name: "Adam", Address: "London", Contact: 123456 },
      { JobId: "456", Name: "Bob", Address: "Cambridge", Contact: "" },
      { JobId: "789", Name: "Charlie", Address: "Oxford", Contact: null },
      { JobId: "012", Name: "Dana", Address: "York" },
    ]);

    expect(result).toEqual({
      validRecords: [
        {
          JobId: "123",
          Name: "Adam",
          Address: "London",
          Contact: "123456",
        },
        { JobId: "456", Name: "Bob", Address: "Cambridge", Contact: "" },
        { JobId: "789", Name: "Charlie", Address: "Oxford", Contact: "" },
        { JobId: "012", Name: "Dana", Address: "York" },
      ],
      failedRecords: [],
    });
  });

  it("rejects null required fields and an unsupported Contact type", () => {
    const record = {
      JobId: null,
      Name: null,
      Address: 123,
      Contact: true,
    };

    const result = validateRecords([record]);

    expect(result.validRecords).toEqual([]);
    expect(result.failedRecords).toEqual([
      {
        record,
        errors: [
          "JobId is required",
          "Name must be a non-null string",
          "Address must be a non-null string",
          "Contact must be a string when provided",
        ],
      },
    ]);
  });

  it("accepts the first occurrence of a JobId and rejects subsequent occurrences", () => {
    const firstRecord = { JobId: "123", Name: "Adam", Address: "London" };
    const duplicateRecord = {
      JobId: "123",
      Name: "Bob",
      Address: "Cambridge",
    };

    const result = validateRecords([firstRecord, duplicateRecord]);

    expect(result.validRecords).toEqual([firstRecord]);
    expect(result.failedRecords).toEqual([
      {
        record: duplicateRecord,
        errors: ["Duplicate JobId: 123"],
      },
    ]);
  });
});

describe("validateAndParseCSV", () => {
  const fixturesDirectory = join(__dirname, "..", "fixtures", "csvFiles");

  it.each(["Customer1.csv", "Customer2.csv"])(
    "parses and validates all records in %s",
    (fixtureName) => {
      const csv = readFileSync(join(fixturesDirectory, fixtureName));
      const result = validateAndParseCSV(csv);

      expect(result.validRecords).toEqual(parseCSVFile(csv));
      expect(result.failedRecords).toEqual([]);
    },
  );

  it("returns parsed but invalid records in failedRecords", () => {
    const csv = Buffer.from(
      "Job Reference,Applicant Name,Residential Address,Contact Info\n" +
        "JOB-2,Valid Name,Cambridge,\n" +
        "JOB-2,Duplicate Name,Oxford,\n",
    );

    const result = validateAndParseCSV(csv);

    expect(result.validRecords).toEqual([
      { JobId: "JOB-2", Name: "Valid Name", Address: "Cambridge", Contact: "" },
    ]);
    expect(result.failedRecords).toEqual([
      {
        record: {
          JobId: "JOB-2",
          Name: "Duplicate Name",
          Address: "Oxford",
          Contact: "",
        },
        errors: ["Duplicate JobId: JOB-2"],
      },
    ]);
  });
});
