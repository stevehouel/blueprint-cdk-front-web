import { Stack, StackProps } from 'aws-cdk-lib';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { InfraStage, InfraStageProps } from './infra-stage';

export interface StageEnvironment extends InfraStageProps {
  readonly name: string;
  readonly testing: boolean;
}

interface PipelineStackProps extends StackProps {
  readonly projectName: string;
  readonly selfMutating: boolean;
  readonly repositoryName: string;
  readonly branchName: string;
  readonly connectionArn: string;
  readonly stages: StageEnvironment[];
}

export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const source = CodePipelineSource.connection(props.repositoryName, props?.branchName, {
      connectionArn: props?.connectionArn,
    });

    const pipeline = new CodePipeline(this, 'pipeline', {
      selfMutation: props.selfMutating,
      synth: new ShellStep('Synth', {
        input: source,
        commands: [
          'make install',
          'make build',
          'make synth'
        ],
        primaryOutputDirectory: 'packages/infra/cdk.out'
      }),
    });

    for(const stage of props.stages) {
      const infra = new InfraStage(this, stage.name, {
        buildAccount: this.account,
        ...stage
      });
      // Adding Infra Stage and WebSync steps
      const webStage = pipeline.addStage(infra, {
        post: [

        ]
      });

      if(stage.testing) {
        // Adding testing step
        webStage.addPost()
      }
    }
  }
}
