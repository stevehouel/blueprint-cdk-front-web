import {Construct} from 'constructs';
import {Stage, StageProps} from 'aws-cdk-lib';

export interface InfraStageProps extends StageProps {
}

export class InfraStage extends Stage {

  constructor(scope: Construct, id: string, props?: InfraStageProps) {
    super(scope, id, props);

  }
}