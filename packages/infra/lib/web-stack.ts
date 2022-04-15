import {CfnOutput, Duration, RemovalPolicy, Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
  AllowedMethods,
  Distribution,
  OriginAccessIdentity,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerCertificate,
  ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront';
import {BlockPublicAccess, Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {Dashboard, GraphWidget, GRID_WIDTH, MathExpression, Metric, TextWidget} from 'aws-cdk-lib/aws-cloudwatch';
import {ARecord, HostedZone, IHostedZone, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {CloudFrontTarget} from 'aws-cdk-lib/aws-route53-targets';
import {Certificate, DnsValidatedCertificate, ICertificate} from 'aws-cdk-lib/aws-certificatemanager';
import {BucketDeployment, Source} from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import {S3Origin} from 'aws-cdk-lib/aws-cloudfront-origins';

const GLOBAL_REGION = 'us-east-1';

interface WebStackProps extends StackProps {
  readonly domainName?: string;
  readonly buildAccount?: string;
  readonly hostedZoneId?: string;
  readonly certificateArn?: string;
  readonly websiteOutputDir: string;
}

export class WebStack extends Stack {

  /**
   * The CloudFront Distribution identifier
   */
  public readonly distributionIdOutput: CfnOutput;

  /**
   * The CloudFront Distribution domain
   */
  public readonly distributionUrlOutput: CfnOutput;

  /**
   * The Web Bucket name
   */
  public readonly bucketNameOutput: CfnOutput;

  public readonly bucketArnOutput: CfnOutput;

  /** Canonical id of the CloudFront Origin Access Identity. */
  public readonly canonicalIdOutput: CfnOutput;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const cloudfrontOAI = new OriginAccessIdentity(this, 'cloudfront-OAI', {
      comment: `OAI for ${this.stackName}`
    });

    // S3 Access Logs Bucket for Frontend stack
    const webAccessLogsBucket = new Bucket(this, 'WebAccessLogsBucket', {
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsPrefix: 'webAccessLogsBucket/',
    });

    const websiteBucket = new Bucket(this, 'WebBucket', {
      publicReadAccess: false,
      bucketName: this.stackName.toLowerCase().concat('-web'),
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsPrefix: 'websiteBucket/',
      serverAccessLogsBucket: webAccessLogsBucket,
    });
    websiteBucket.grantRead(cloudfrontOAI);

    let certificate: ICertificate | undefined;
    let hostedZone: IHostedZone | undefined;
    let domainNames: string[] = [];

    if (props.certificateArn && props.domainName) {
      certificate = Certificate.fromCertificateArn(this, 'CertificateImported', props.certificateArn);
      domainNames.push(props.domainName);
    } else if (props.hostedZoneId && props.domainName) {
      hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });
      certificate = new DnsValidatedCertificate(this, 'Certificate', {
        domainName: props.domainName,
        hostedZone: hostedZone,
      });
      domainNames.push(props.domainName);
    }

    // Creating CloudFront distribution
    const distribution = new Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: new S3Origin(websiteBucket, {originAccessIdentity: cloudfrontOAI}),
        compress: true,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses:[
        {
          httpStatus: 403,
          responseHttpStatus: 403,
          responsePagePath: '/error.html',
          ttl: Duration.minutes(30),
        }
      ],
      certificate: certificate,
      domainNames: domainNames,
      priceClass: PriceClass.PRICE_CLASS_100,
    });

    if (hostedZone && props.domainName) {
      new ARecord(this, 'APIAliasRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        ttl: Duration.minutes(15),
      });
    }

    new BucketDeployment(this, 'DeployWebsite', {
      sources: [Source.asset(path.join(__dirname, props.websiteOutputDir))],
      destinationBucket: websiteBucket,
      memoryLimit: 3000,
      prune: false,
      distribution: distribution
    });

    this.distributionIdOutput = new CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });

    this.distributionUrlOutput = new CfnOutput(this, 'DistributionUrl', {
      value: distribution.distributionDomainName,
    });

    this.bucketNameOutput = new CfnOutput(this, 'WebBucketName', {
      value: websiteBucket.bucketName,
    });
    this.bucketArnOutput = new CfnOutput(this, 'WebBucketArn', {
      value: websiteBucket.bucketArn,
    });

    // ** CW Dashboard **
    const dashboard = new Dashboard(this, 'WebDashboard', {});

    dashboard.addWidgets(
      new TextWidget({
        markdown: '# Cloudfront Metrics',
        width: GRID_WIDTH,
        height: 1,
      }),
      new GraphWidget({
        width: 12,
        height: 9,
        title: 'Requests (sum)',
        region: GLOBAL_REGION,
        left: [
          new Metric({
            namespace: 'AWS/CloudFront',
            metricName: 'Requests',
            statistic: 'Sum',
            period: Duration.seconds(300),
            dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
          }),
        ],
      }),
      new GraphWidget({
        width: 12,
        height: 9,
        title: 'Data transfer',
        region: GLOBAL_REGION,
        left: [
          new Metric({
            namespace: 'AWS/CloudFront',
            metricName: 'BytesUploaded',
            statistic: 'Sum',
            period: Duration.seconds(300),
            dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
          }),
          new Metric({
            namespace: 'AWS/CloudFront',
            metricName: 'BytesDownloaded',
            statistic: 'Sum',
            period: Duration.seconds(300),
            dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
          }),
        ],
      }),
      new GraphWidget({
        width: 24,
        height: 6,
        title: 'Error rate (as a percentage of total requests)',
        region: GLOBAL_REGION,
        left: [
          new Metric({
            namespace: 'AWS/CloudFront',
            metricName: 'TotalErrorRate',
            statistic: 'Average',
            period: Duration.seconds(300),
            dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
          }),
          new Metric({
            namespace: 'AWS/CloudFront',
            metricName: '4xxErrorRate',
            label: 'Total4xxErrors',
            statistic: 'Average',
            period: Duration.seconds(300),
            dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
          }),
          new Metric({
            namespace: 'AWS/CloudFront',
            metricName: '5xxErrorRate',
            label: 'Total5xxErrors',
            statistic: 'Average',
            period: Duration.seconds(300),
            dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
          }),
          new MathExpression({
            usingMetrics: {
              m4: new Metric({
                namespace: 'AWS/CloudFront',
                metricName: 'LambdaExecutionError',
                statistic: 'Sum',
                period: Duration.seconds(300),
                dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
              }),
              m5: new Metric({
                namespace: 'AWS/CloudFront',
                metricName: 'LambdaValidationError',
                statistic: 'Sum',
                period: Duration.seconds(300),
                dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
              }),
              m6: new Metric({
                namespace: 'AWS/CloudFront',
                metricName: 'LambdaLimitExceededErrors',
                statistic: 'Sum',
                period: Duration.seconds(300),
                dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
              }),
              m7: new Metric({
                namespace: 'AWS/CloudFront',
                metricName: 'Requests',
                statistic: 'Sum',
                period: Duration.seconds(300),
                dimensionsMap: { Region: 'Global', DistributionId: distribution.distributionId },
              }),
            },
            expression: '(m4+m5+m6)/m7*100',
            label: '5xxErrorByLambdaEdge',
          }),
        ],
      }),
    );
  }
}
