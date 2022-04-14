import { Stack, StackProps } from 'aws-cdk-lib';
import {CodeBuildStep, CodePipeline, CodePipelineSource, ShellStep} from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { InfraStage, InfraStageProps } from './infra-stage';
import {PolicyStatement} from 'aws-cdk-lib/aws-iam';

export interface StageEnvironment extends InfraStageProps {
  readonly name: string;
  readonly testing: boolean;
  readonly testingRoleArn?: string;
}

interface PipelineStackProps extends StackProps {
  readonly projectName: string;
  readonly selfMutating: boolean;
  readonly repositoryName: string;
  readonly branchName: string;
  readonly connectionArn: string;
  readonly webOutputDir: string;
  readonly stages: StageEnvironment[];
}

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const source = CodePipelineSource.connection(props.repositoryName, props?.branchName, {
      connectionArn: props?.connectionArn,
    });

    // Synth Step
    const synthStep = new ShellStep('Synth', {
      input: source,
      installCommands: [
        'make install'
      ],
      commands: [
        'make lint',
        'make build',
        'CI=true make test',
        'make synth'
      ],
      primaryOutputDirectory: 'packages/infra/cdk.out',
    });

    const pipeline = new CodePipeline(this, 'pipeline', {
      selfMutation: props.selfMutating,
      crossAccountKeys: true, // Encrypt artifacts, required for cross-account deployments
      synth: synthStep,
    });

    for(const stage of props.stages) {
      const infra = new InfraStage(this, stage.name, {
        buildAccount: this.account,
        ...stage
      });
      // Adding Infra Stage and WebSync steps
      const webStage = pipeline.addStage(infra, {
        post: [
          new CodeBuildStep('Web Sync', {
            input: synthStep.addOutputDirectory(props.webOutputDir),
            envFromCfnOutputs: {
              WEB_BUCKET_NAME: infra.bucketNameOutput,
              DISTRIBUTION_ID: infra.distributionIdOutput,
            },
            commands: [
              'make configure-ui',
              'make invalidate-distribution'
            ],
            rolePolicyStatements: [
              new PolicyStatement({
                resources: [
                  infra.bucketArnOutput.value,
                  `${infra.bucketArnOutput.value}/*`,
                ],
                actions: [
                  's3:List*',
                  's3:Abort*',
                  's3:GetObject*',
                  's3:PutObject*',
                  's3:DeleteObject*'
                ]
              }),
              new PolicyStatement({
                resources: ['*'],
                actions: ['cloudformation:ListExports']
              })
            ]
          })
        ]
      });

      if(stage.testing) {
        const policies = [];
        if(stage.testingRoleArn) {
          // Make testing role assumable
          policies.push(new PolicyStatement({
            resources: [ stage.testingRoleArn ],
            actions: [ 'sts:assumeRole' ],
          }));
        }
        // Adding testing step
        webStage.addPost(new CodeBuildStep('Functional Testing', {
          input: synthStep.addOutputDirectory(props.webOutputDir),
          envFromCfnOutputs: {
            WEB_URL: infra.webUrlOutput
          },
          commands: [
            'make test-ui'
          ],
          rolePolicyStatements: policies
        }))
      }
    }
  }
}
