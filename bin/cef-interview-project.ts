#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { CefInterviewProjectStack } from "../lib/cef-interview-project-stack";

const app = new cdk.App();
new CefInterviewProjectStack(app, "CefInterviewProjectStack", {
  env: {
    account: "123456789012",
    region: "us-east-1",
  },
});
