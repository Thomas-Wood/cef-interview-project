This file sets out the brief and any key assumptions or design decisions.

# Original brief

Design and implement an AWS solution that ingests CSV files containing job information upon upload and securely stores the records.
The Job reference is unique to the customer.

See files Customer1.csv and Customer2.csv

## Data analysis

### Headings

The headings in each file differ in more than just case. While there are the same number of headings and the content is in the same order, best not to assume that will always be the case. Therefore a key requirement will be the normalisation and parsing of the data.

There's no easy way to determine without context or a human if a string is a name of a contact, an address etc. Since the files have the data in the same order, **I will assume that all files will have the data in the same order of job reference, name, address, contact info and that a heading row exists.**

### Records and data validation

Some of the records are malformed so general parsing and error handling will be needed such that one bad row does not prevent the whole file being read.

Some values and rows use single quotes, double quotes, double-double quotes and commas within a value (addresses). Extra care will be needed here to make sure that can be safely parsed.

Some values have blank spaces around them which can be stripped.

One record is broken by extra line breaks in the address. This should be handled by any decent CSV reader but worth noting to check.

### Job reference

- Required (don't store a record with no id, but do flag/log it)
- String
- Unique within that file (What happens for duplicates? - **Take first instance as correct, skip and log all other occurances**)

### Name

- Required
- String

### Address

- Required
- String

### Contact details (email/phone number)

- Optional (several rows missing this data so appears normal for this data set. **Assumed contact is optional**)
- String
- Must conform to an email or phone number structure

# Infrastructure Design

## CSV storage

An S3 bucket connected with an SFTP server via AWS Transfer family.

## Processing

Upon a file being uploaded, events will trigger a Lambda which will collect the file, process it, and store it in a database.
**This assumes that the files are always small enough to be fully processed in the 15min life of a Lambda**
Benefits of a Lambda in this case means that it can handle a large influx of files quickly depending on the max concurrency and throughout of the database.
Benefits of an EC2 instance; it can handle effectivly any file size (using byte ranges to specify part of a large file so excessive memory isn't required). Downside is that it is slower to start up and less light weight than a lambda which can be kept alive for follow up requests.

## Security (files)

**It is assumed that the incoming files are trusted to be free of viruses etc**
This system will still do general checks such as for the file type but will assume there is not a risk of viruses.
If that assumption is wrong, antiVirus checkers such as ClamAV could be intergrated to check the files first.

## Database

The choice between an SQL and a noSQL DB largely comes down to how the data is expected to be used. If the data is expected to be retrieved by the id only, then the benefits of hash tables means a NoSQL DB such as DynamoDB or MongoDB would be best. If the data is expected to be queried in more dimensions such as to find all addresses that include "London" then the flexability in queries of an SQL DB may be more suitable. The brief does not give enough context to determine this.

SQL DBs are also better for very large datasets with relationships. However this data set does not have any relationships to consider.

On balance, the NoSQL DB is more appropriate.

MongoDB is better suited to handling a variety of fields in it's documents. DynamoDB has a slightly stricter structure for fields. Since we're going to be validating and processing all the fields, I think DynamoDB would be more appropriate here. AWS DynamoDB also handles security by encrypting all data via KMS.

## File handling

The file names appear unique but is not stated if further files from the same customer would have the same file name or not.
**I assume that each customer has a unique file name that is reused for that customer if further files are uploaded.**
This Customer ID (from the file name) can be the Partition Key (PK). The job reference will then be the Sort key (SK).

**Once a file has been processed, I assume that it should be left in place (rather than deleted)**
