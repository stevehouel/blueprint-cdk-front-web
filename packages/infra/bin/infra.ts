#!/usr/bin/env node
import 'source-map-support/register';

import { PipelineStack } from '../lib/pipeline-stack';
import {App} from 'aws-cdk-lib';
import {resolve} from 'path';
import {readFileSync} from 'fs';

const REGION = process.env.REGION || 'eu-west-1';
const PROJECT_NAME = process.env.PROJECT_NAME || 'BlueprintCdkFrontWeb';
const PIPELINE_STACK = process.env.PIPELINE_STACK || `${PROJECT_NAME}-Pipeline`;

const configFilePath = resolve(__dirname, '../config/infra-config.json');
const config = JSON.parse(readFileSync(configFilePath).toString());

const app = new App();

new PipelineStack(app, PIPELINE_STACK, {
  ...config,
  projectName: PROJECT_NAME,
  env: {
    region: REGION
  }
});

app.synth();

