import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { CefInterviewProjectStack } from "../lib/cef-interview-project-stack";

describe("CefInterviewProjectStack", () => {
  const app = new App();
  const stack = new CefInterviewProjectStack(app, "TestStack");
  const template = Template.fromStack(stack);

  it("creates a retained DynamoDB table with the expected keys and recovery enabled", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      Properties: {
        AttributeDefinitions: [
          { AttributeName: "customerName", AttributeType: "S" },
          { AttributeName: "JobId", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "customerName", KeyType: "HASH" },
          { AttributeName: "JobId", KeyType: "RANGE" },
        ],
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      },
    });
  });

  it("creates a retained S3 bucket that invokes the processor on object creation", () => {
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
    });
    template.hasResourceProperties(
      "Custom::S3BucketNotifications",
      Match.objectLike({
        NotificationConfiguration: {
          LambdaFunctionConfigurations: Match.arrayWith([
            Match.objectLike({
              Events: ["s3:ObjectCreated:*"],
              LambdaFunctionArn: Match.anyValue(),
            }),
          ]),
        },
      }),
    );
  });

  it("configures the processor Lambda with the expected runtime and maximum timeout", () => {
    template.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Handler: "index.handler",
        Runtime: "nodejs24.x",
        MemorySize: 1024,
        Timeout: 900,
        Environment: {
          Variables: Match.objectLike({
            JOBS_TABLE_NAME: Match.anyValue(),
            S3_BUCKET_NAME: Match.anyValue(),
          }),
        },
      }),
    );
  });

  it("grants the processor Lambda read access to S3 and read/write access to DynamoDB", () => {
    template.hasResourceProperties(
      "AWS::IAM::Policy",
      Match.objectLike({
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Action: Match.arrayWith(["s3:GetObject*"]),
              Resource: Match.arrayWith([
                Match.objectLike({
                  "Fn::GetAtt": [
                    Match.stringLikeRegexp("CustomerFilesBucket.*"),
                    "Arn",
                  ],
                }),
              ]),
            }),
            Match.objectLike({
              Effect: "Allow",
              Action: Match.arrayWith([
                "dynamodb:BatchWriteItem",
                "dynamodb:PutItem",
              ]),
              Resource: Match.arrayWith([
                {
                  "Fn::GetAtt": [
                    Match.stringLikeRegexp("JobsTable.*"),
                    "Arn",
                  ],
                },
              ]),
            }),
          ]),
        },
      }),
    );
  });

  it("retains the Lambda log group with one-month retention", () => {
    template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Retain",
      Properties: {
        RetentionInDays: 30,
      },
    });
  });
});
