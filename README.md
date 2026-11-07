# CEF Interview Project - CSV import, validation and storage

This projects purpose is to ingest CSV files from customers, validate and standardise the data, then securely store it in DynamoDB.

## Brief

The original brief, assumptions and design considerations can be found in brief/BRIEF.md

## This repo follows conventional commits

e.g.
feat: allow provided config object to extend other configs
BREAKING CHANGE: `extends` key in config file is now used for extending other config files
docs: updated readme file
chore: project setup

## Stack overview

This stack consists of an S3 bucket, a lambda which is triggered by S3 upload events, and a Dynamo database to store valid records from the input files.

## Data flow

1. A file is uploaded into S3 at any location (Could be via SFTP but that has not been setup on this project).
2. This triggeres an event which starts the lambda
3. The file is checked that it's a csv then starts to process it
4. Each value is checks to make sure it is present and of the correct data type where required. Job ids must also be unique within the file. Future files with duplicates ids from an earlier file will overwrite the original.
5. Valid and invalid records are handled. Invalid ones are logged (could be setup with other systems later on such as being written back to S3, making sure not to cause an infinite loop with the events).
6. Valid records are sent to DynamoDB. Unprocessable records are retried then eventually returned and logged. The DynamoDB setup uses the Customer name (from the file) as the partition key and the job id for the sort key.

## Useful commands

- `npm run build` type-check the project
- `npm run watch` watch for changes and type-check
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
