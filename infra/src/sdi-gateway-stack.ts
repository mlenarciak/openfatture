import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CfnOutput, Duration, Fn, RemovalPolicy, Stack, type StackProps,
  aws_certificatemanager as acm, aws_ec2 as ec2, aws_ecs as ecs,
  aws_ecr_assets as ecrAssets, aws_elasticloadbalancingv2 as elbv2,
  aws_iam as iam, aws_kms as kms, aws_logs as logs,
  aws_route53 as route53, aws_route53_targets as route53Targets, aws_s3 as s3,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { SdiGatewayConfig } from './sdi-gateway-config.js';

export interface SdiTestGatewayStackProps extends StackProps {
  config: SdiGatewayConfig;
  /** Test injection avoids Docker assets in infrastructure unit tests. */
  containerImage?: ecs.ContainerImage;
}

/** Independent TEST ingress: no access to the business ledger, outbox, user pool or private TLS keys. */
export class SdiTestGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props: SdiTestGatewayStackProps) {
    super(scope, id, props);
    const { config } = props;
    const vpc = new ec2.Vpc(this, 'Network', {
      ipAddresses: ec2.IpAddresses.cidr('10.83.0.0/20'),
      availabilityZones: [Fn.select(0, Fn.getAzs(this.region)), Fn.select(1, Fn.getAzs(this.region))],
      natGateways: 0,
      subnetConfiguration: [{ name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      restrictDefaultSecurityGroup: true,
    });
    const albSecurityGroup = new ec2.SecurityGroup(this, 'IngressSecurityGroup', { vpc, allowAllOutbound: false, description: 'SdI TEST client HTTPS only' });
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'ReceiverSecurityGroup', { vpc, allowAllOutbound: false, description: 'Only the verified mTLS ALB can reach the receiver' });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'SdI TEST mTLS');
    albSecurityGroup.addEgressRule(taskSecurityGroup, ec2.Port.tcp(8080), 'Receiver and internal health check');
    taskSecurityGroup.addIngressRule(albSecurityGroup, ec2.Port.tcp(8080), 'ALB only');
    taskSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'S3, ECR and CloudWatch HTTPS without NAT');

    const inboxKey = new kms.Key(this, 'InboxKey', { enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN, description: 'Openfatture SdI TEST inbox only' });
    const inbox = new s3.Bucket(this, 'Inbox', {
      encryption: s3.BucketEncryption.KMS, encryptionKey: inboxKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true, removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    });
    const connectionLogs = new s3.Bucket(this, 'IngressLogs', {
      encryption: s3.BucketEncryption.S3_MANAGED, blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true, objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN, lifecycleRules: [{ expiration: Duration.days(90) }],
    });
    const receiverLogs = new logs.LogGroup(this, 'ReceiverLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.RETAIN });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });
    const task = new ecs.FargateTaskDefinition(this, 'ReceiverTask', {
      cpu: 256, memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const prefix = `test/${config.providerContext}/*`;
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ['s3:PutObject'], resources: [inbox.arnForObjects(prefix)], conditions: { StringEquals: { 's3:x-amz-server-side-encryption': 'aws:kms', 's3:x-amz-server-side-encryption-aws-kms-key-id': inboxKey.keyArn } } }));
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ['kms:Encrypt', 'kms:GenerateDataKey', 'kms:Decrypt'], resources: [inboxKey.keyArn], conditions: { StringEquals: { 'kms:ViaService': `s3.${this.region}.amazonaws.com` }, StringLike: { 'kms:EncryptionContext:aws:s3:arn': inbox.arnForObjects(prefix) } } }));

    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const image = props.containerImage ?? ecs.ContainerImage.fromAsset(repoRoot, {
      file: 'apps/sdi-gateway/Dockerfile', platform: ecrAssets.Platform.LINUX_AMD64,
      // Build context contains application sources only. Private keys and issued certificates stay outside Git and the image.
      exclude: ['.git', '.git/**', 'node_modules', '**/node_modules/**', '**/.data/**', '**/.venv/**', 'infra/src/**', 'infra/test/**', 'infra/cdk.out/**', 'infra/cdk.context.json', 'docs', 'docs/**', 'scripts', 'scripts/**', 'apps/web/src/**', 'apps/web/public/**', 'apps/web/test/**', 'apps/api/src/**', 'apps/api/test/**', '**/test/**', 'tests/**', '**/references/**', 'playwright-report/**', '**/test-results/**', '**/dist/**', '**/coverage/**', '**/*.md', '.env', '**/.env*', '**/*.pem', '**/*.key', '**/*.cer', '**/*.crt', '**/*.csr', '**/*.der', '**/*.p12', '**/*.pfx', '**/*.log'],
    });
    const container = task.addContainer('Receiver', {
      image, user: '1000:1000', readonlyRootFilesystem: true, privileged: false,
      versionConsistency: ecs.VersionConsistency.ENABLED,
      logging: ecs.LogDrivers.awsLogs({ logGroup: receiverLogs, streamPrefix: 'receiver', mode: ecs.AwsLogDriverMode.NON_BLOCKING }),
      environment: {
        NODE_ENV: 'production', PORT: '8080', AWS_REGION: this.region, SDI_PROXY_MODE: 'alb',
        SDI_ARTIFACTS_BUCKET: inbox.bucketName, SDI_KMS_KEY_ID: inboxKey.keyArn,
        SDI_TEST_PEER_SHA256: config.testPeerSha256.join(','), SDI_PROVIDER_CONTEXT: config.providerContext,
      },
      portMappings: [{ containerPort: 8080, protocol: ecs.Protocol.TCP }],
      stopTimeout: Duration.seconds(30),
    });
    const service = new ecs.FargateService(this, 'ReceiverService', {
      cluster, taskDefinition: task, desiredCount: 1, assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, securityGroups: [taskSecurityGroup],
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200,
      healthCheckGracePeriod: Duration.seconds(60), enableExecuteCommand: false,
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Ingress', {
      vpc, internetFacing: true, vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: albSecurityGroup, dropInvalidHeaderFields: true,
      desyncMitigationMode: elbv2.DesyncMitigationMode.STRICTEST,
      idleTimeout: Duration.seconds(60), deletionProtection: true,
    });
    alb.logAccessLogs(connectionLogs, 'access');
    alb.logConnectionLogs(connectionLogs, 'connections');
    const truststore = new elbv2.TrustStore(this, 'PeerTruststore', {
      bucket: s3.Bucket.fromBucketName(this, 'ReviewedCaBucket', config.truststoreBucketName),
      key: config.truststoreKey, version: config.truststoreVersion,
    });
    const listener = alb.addListener('MutualTls', {
      port: 443, protocol: elbv2.ApplicationProtocol.HTTPS, open: false,
      certificates: [acm.Certificate.fromCertificateArn(this, 'IssuedSdiServerCertificate', config.serverCertificateArn)],
      sslPolicy: elbv2.SslPolicy.TLS13_RES,
      mutualAuthentication: { mutualAuthenticationMode: elbv2.MutualAuthenticationMode.VERIFY, trustStore: truststore, ignoreClientCertificateExpiry: false, advertiseTrustStoreCaNames: true },
      defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: 'text/plain', messageBody: 'SdI production transport is disabled.' }),
    });
    listener.addTargets('TestSoapOnly', {
      port: 8080, protocol: elbv2.ApplicationProtocol.HTTP, priority: 10,
      conditions: [elbv2.ListenerCondition.httpRequestMethods(['POST']), elbv2.ListenerCondition.pathPatterns(['/test/RicezioneFatture', '/test/TrasmissioneFatture'])],
      targets: [service.loadBalancerTarget({ containerName: container.containerName, containerPort: 8080 })],
      healthCheck: { path: '/health', healthyHttpCodes: '200', interval: Duration.seconds(30), timeout: Duration.seconds(5), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
      deregistrationDelay: Duration.seconds(30),
    });
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'ExistingZone', { hostedZoneId: config.hostedZoneId, zoneName: 'openfatture.com' });
    new route53.ARecord(this, 'TestHostname', { zone, recordName: config.hostname, target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(alb)) });
    new CfnOutput(this, 'SdiTestReceiveEpr', { value: `https://${config.hostname}/test/RicezioneFatture` });
    new CfnOutput(this, 'SdiTestNotificationEpr', { value: `https://${config.hostname}/test/TrasmissioneFatture` });
    new CfnOutput(this, 'TestInboxBucket', { value: inbox.bucketName });
    new CfnOutput(this, 'TestInboxKeyArn', { value: inboxKey.keyArn });
    new CfnOutput(this, 'IngressDnsName', { value: alb.loadBalancerDnsName });
    new CfnOutput(this, 'ReceiverServiceName', { value: service.serviceName });
    new CfnOutput(this, 'PeerTruststoreArn', { value: truststore.trustStoreArn });
  }
}
