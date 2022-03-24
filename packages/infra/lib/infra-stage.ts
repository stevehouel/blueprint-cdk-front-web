import {Construct} from 'constructs';
import {CfnOutput, Stage, StageProps} from 'aws-cdk-lib';
import {WebStack} from './web-stack';

export interface InfraStageProps extends StageProps {
  readonly buildAccount?: string;
  readonly domainName: string;
  readonly hostedZoneId?: string;
  readonly certificateArn?: string;
}

export class InfraStage extends Stage {

  /**
   * The CloudFront Distribution identifier
   */
  public readonly distributionIdOutput: CfnOutput;

  /**
   * The Web Bucket name
   */
  public readonly bucketNameOutput: CfnOutput;
  public readonly bucketArnOutput: CfnOutput;
  /** Canonical id of the CloudFront Origin Access Identity. */
  public readonly canonicalIdOutput: CfnOutput;

  constructor(scope: Construct, id: string, props: InfraStageProps) {
    super(scope, id, props);

    const webStack = new WebStack(this, `${this.stageName}-Infra`, props);
    this.distributionIdOutput = webStack.distributionIdOutput;
    this.bucketNameOutput = webStack.bucketNameOutput;
    this.bucketArnOutput = webStack.bucketArnOutput;
    this.canonicalIdOutput = webStack.canonicalIdOutput;

  }
}