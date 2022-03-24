#!/usr/bin/env node
import 'source-map-support/register';

import { PipelineStack } from '../lib/pipeline-stack';
import {App} from 'aws-cdk-lib';

const REGION = process.env.REGION || 'eu-west-1';
const PROJECT_NAME = process.env.PROJECT_NAME || 'BlueprintCdkFrontWeb';
const PIPELINE_STACK = process.env.PIPELINE_STACK || `${PROJECT_NAME}-PIPELINE`;

const app = new App();

new PipelineStack(app, PIPELINE_STACK, {
  repositoryName: '',
  branchName: 'main',
  connectionArn: '',
  selfMutating: true,
  env: {
    region: REGION,
  },
  stages: [
    {
      name: 'Testing'
    }
  ],
});

app.synth();

