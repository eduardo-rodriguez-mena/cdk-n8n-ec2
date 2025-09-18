#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { N8nStack } from '../lib/n8n-stack';

const app = new cdk.App();

new N8nStack(app, 'N8nStack', {
  env: {
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION || 'us-east-1',
  },
  description: 'n8n workflow automation deployment on AWS EC2',
  tags: {
    Project: 'n8n-aws',
    Environment: 'PoC',
    ManagedBy: 'CDK'
  }
});