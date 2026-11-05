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

## Useful commands

- `npm run build` type-check the project
- `npm run watch` watch for changes and type-check
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
