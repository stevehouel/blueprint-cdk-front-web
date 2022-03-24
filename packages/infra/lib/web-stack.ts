import {CfnOutput, Duration, Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
  CloudFrontWebDistribution,
  OriginAccessIdentity,
  PriceClass, SecurityPolicyProtocol,
  ViewerCertificate,
  ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront';
import {BlockPublicAccess, Bucket, BucketEncryption} from 'aws-cdk-lib/aws-s3';
import {AccountPrincipal} from 'aws-cdk-lib/aws-iam';
import {
  Dashboard,
  GraphWidget,
  GRID_WIDTH,
  MathExpression,
  Metric,
  TextWidget
} from 'aws-cdk-lib/aws-cloudwatch';
import {ARecord, HostedZone, IHostedZone, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {CloudFrontTarget} from 'aws-cdk-lib/aws-route53-targets';
import {Certificate, DnsValidatedCertificate} from 'aws-cdk-lib/aws-certificatemanager';

const GLOBAL_REGION = 'us-east-1';

interface WebStackProps extends StackProps {
  readonly domainName?: string;
  readonly buildAccount?: string;
  readonly hostedZoneId?: string;
  readonly certificateArn?: string;
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

    // S3 Access Logs Bucket for Frontend stack
    const webAccessLogsBucket = new Bucket(this, 'WebAccessLogsBucket', {
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsPrefix: 'webAccessLogsBucket/',
    });

    const oai = new OriginAccessIdentity(this, 'OAI');
    const websiteBucket = new Bucket(this, 'WebBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      bucketName: this.stackName.toLowerCase().concat('-web'),
      encryption: BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsPrefix: 'websiteBucket/',
      serverAccessLogsBucket: webAccessLogsBucket,
    });
    websiteBucket.grantRead(oai);

    // Create Cross-account access policy for Web Sync
    if(props.buildAccount) {
      websiteBucket.grantReadWrite(new AccountPrincipal(props.buildAccount));
    }

    let viewerCertificate: ViewerCertificate | undefined;
    let hostedZone: IHostedZone | undefined;

    if (props.certificateArn && props.domainName) {
      const certificate = Certificate.fromCertificateArn(this, 'CertificateImported', props.certificateArn);
      viewerCertificate = ViewerCertificate.fromAcmCertificate(certificate, {
        aliases: [ props.domainName ],
        securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2019,
      });
    } else if (props.hostedZoneId && props.domainName) {
      hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });
      const certificate = new DnsValidatedCertificate(this, 'Certificate', {
        domainName: props.domainName,
        hostedZone: hostedZone,
      });
      viewerCertificate = ViewerCertificate.fromAcmCertificate(certificate, {
        aliases: [ props.domainName ],
        securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2019,
      });
    }

    // Creating CloudFront distribution secured by Lambda@Edge
    const distribution = new CloudFrontWebDistribution(this, 'WebDistribution', {
      viewerCertificate,
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: websiteBucket,
            originAccessIdentity: oai,
          },
          behaviors: [{
            isDefaultBehavior: true,
            defaultTtl: Duration.seconds(300),
          }],
        },
      ],
      priceClass: PriceClass.PRICE_CLASS_ALL,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      errorConfigurations: [
        {
          errorCode: 404,
          responseCode: 200,
          responsePagePath: '/index.html',
        },
        {
          errorCode: 403,
          responseCode: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    if (hostedZone && props.domainName) {
      new ARecord(this, 'APIAliasRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
        ttl: Duration.minutes(15),
      });
    }

    this.distributionIdOutput = new CfnOutput(this, 'ExportDistributionId', {
      value: distribution.distributionId,
      exportName: 'WebDistributionId',
    });

    this.distributionUrlOutput = new CfnOutput(this, 'ExportDistributionUrl', {
      value: distribution.distributionDomainName,
    });

    this.bucketNameOutput = new CfnOutput(this, 'ExportBucketName', {
      value: websiteBucket.bucketName,
      exportName: 'WebBucketName',
    });
    this.bucketArnOutput = new CfnOutput(this, 'ExportBucketArn', {
      value: websiteBucket.bucketArn,
    });
    this.canonicalIdOutput = new CfnOutput(this, 'CanonicalId', {
      value: oai.cloudFrontOriginAccessIdentityS3CanonicalUserId,
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
