import {
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_dynamodb as dynamodb,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodeJsLambda,
  aws_s3 as s3,
  aws_s3_notifications as s3Notifications,
  aws_logs as logs,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class CefInterviewProjectStack extends Stack {
  private readonly NODEJS_RUNTIME = lambda.Runtime.NODEJS_24_X;

  // Define all key infrastructure
  private jobTable: dynamodb.Table;
  private customerFileProcessingLambda: nodeJsLambda.NodejsFunction;
  private s3Bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.createDynamoDBTable();
    this.createS3Bucket();
    this.createCustomerFileProcessingLambda();
    this.createS3EventTrigger();
  }

  private createDynamoDBTable() {
    this.jobTable = new dynamodb.Table(this, "JobsTable", {
      partitionKey: {
        name: "customerName",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "JobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  private createS3Bucket() {
    this.s3Bucket = new s3.Bucket(this, "CustomerFilesBucket", {
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Note - AWS Tranfer Family does not have a L2 construct in CDK, so it has been left out of this implementation.
    // It would be set up via the AWS management console if this project was deployed.
  }

  private createCustomerFileProcessingLambda() {
    this.customerFileProcessingLambda = new nodeJsLambda.NodejsFunction(
      this,
      "CustomerFileProcessingLambda",
      {
        entry: "src/handlers/customerFileProcessingHandler.ts",
        handler: "handler",
        runtime: this.NODEJS_RUNTIME,
        environment: {
          JOBS_TABLE_NAME: this.jobTable.tableName,
          S3_BUCKET_NAME: this.s3Bucket.bucketName,
        },
        logRetention: logs.RetentionDays.ONE_MONTH,
        description:
          "Lambda function to process customer files and store job information in DynamoDB",
        memorySize: 1024,
        timeout: Duration.minutes(15),
      },
    );
    this.s3Bucket.grantRead(this.customerFileProcessingLambda);
    this.jobTable.grantReadWriteData(this.customerFileProcessingLambda);
  }

  private createS3EventTrigger() {
    this.s3Bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3Notifications.LambdaDestination(this.customerFileProcessingLambda),
    );
  }

  private generateResourceName(name: string): string {
    return `CefInterviewProjectStack-${name}`;
  }
}
