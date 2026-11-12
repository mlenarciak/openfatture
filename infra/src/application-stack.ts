import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, aws_apigateway as restapigw, aws_apigatewayv2 as apigw, aws_apigatewayv2_authorizers as authorizers, aws_apigatewayv2_integrations as integrations, aws_certificatemanager as acm, aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_cloudwatch as cloudwatch, aws_cognito as cognito, aws_iam as iam, aws_lambda as lambda, aws_lambda_nodejs as nodejs, aws_logs as logs, aws_route53 as route53, aws_route53_targets as targets, aws_s3 as s3, aws_s3_deployment as deployment } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { DataStack } from './data-stack.js';
import { deploymentCustomDomain, type CustomDomain } from './custom-domain.js';
import { spaRouterCode } from './spa-router.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
interface ApplicationStackProps extends StackProps {
  data: DataStack;
  stage: 'dev' | 'prod';
  multiTenant?: boolean;
  /** Anonymous, per-tab browser sandbox. Never enables anonymous API access. */
  publicDemo?: boolean;
  selfHostedCompanyId?: string;
  customDomain?: CustomDomain;
  /** Unit tests supply tiny local assets; production always bundles the real handler. */
  apiCode?: lambda.Code;
  webDirectory?: string;
}

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);
    const { data, stage } = props;
    const customDomain = deploymentCustomDomain(props.customDomain?.domainName, props.customDomain?.hostedZoneId, props.customDomain?.certificateArn);
    const multiTenant = props.multiTenant ?? true;
    if (!multiTenant && (!props.selfHostedCompanyId || !/^[a-zA-Z0-9_-]{1,80}$/.test(props.selfHostedCompanyId))) throw new Error('selfHostedCompanyId is required in single-company mode');
    const webDirectory = props.webDirectory ?? path.join(root, 'apps/web/dist');
    if (!existsSync(path.join(webDirectory, 'index.html'))) throw new Error('Build web assets first: npm run build --workspace @openfatture/web');
    const web = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED, versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const routeRewrite = new cloudfront.Function(this, 'SpaRouter', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(spaRouterCode(customDomain?.domainName)),
    });
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'WebHeaders', {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
        contentSecurityPolicy: {
          contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://*.amazoncognito.com",
          override: true,
        },
      },
    });
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultRootObject: 'index.html',
      ...(customDomain ? { domainNames: [customDomain.domainName], certificate: acm.Certificate.fromCertificateArn(this, 'WebCertificate', customDomain.certificateArn) } : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(web),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: headers,
        functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: routeRewrite }],
      },
    });
    const cloudFrontUrl = `https://${distribution.distributionDomainName}`;
    const webUrl = customDomain ? `https://${customDomain.domainName}` : cloudFrontUrl;
    const webOrigins = customDomain ? [webUrl, cloudFrontUrl] : [webUrl];
    if (customDomain) {
      const zone = route53.HostedZone.fromHostedZoneId(this, 'WebHostedZone', customDomain.hostedZoneId);
      const recordProps = { zone, recordName: `${customDomain.domainName}.`, target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)) };
      new route53.ARecord(this, 'WebIpv4Alias', recordProps);
      new route53.AaaaRecord(this, 'WebIpv6Alias', recordProps);
    }
    const domain = new cognito.UserPoolDomain(this, 'HostedLogin', {
      userPool: data.userPool,
      cognitoDomain: { domainPrefix: `openfatture-${stage}-${this.account}` },
    });
    const client = new cognito.UserPoolClient(this, 'WebClient', {
      userPool: data.userPool,
      generateSecret: false, preventUserExistenceErrors: true, enableTokenRevocation: true,
      // Explicit flows avoid Cognito's default REFRESH_TOKEN_AUTH, which conflicts with rotation.
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.minutes(15), idTokenValidity: Duration.minutes(15), refreshTokenValidity: Duration.days(1),
      refreshTokenRotationGracePeriod: Duration.seconds(10),
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE], callbackUrls: webOrigins.map(origin => `${origin}/auth/callback`), logoutUrls: webOrigins.map(origin => `${origin}/`) },
    });
    const apiLogs = new logs.LogGroup(this, 'ApiLogs', { retention: logs.RetentionDays.ONE_MONTH, encryptionKey: data.encryptionKey, removalPolicy: RemovalPolicy.RETAIN });
    data.encryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
      actions: ['kms:Encrypt*', 'kms:Decrypt*', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:Describe*'], resources: ['*'],
      conditions: { ArnLike: { 'kms:EncryptionContext:aws:logs:arn': `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:*` } },
    }));
    const functionProps: Omit<lambda.FunctionProps, 'code' | 'handler'> = {
      runtime: lambda.Runtime.NODEJS_24_X, architecture: lambda.Architecture.ARM_64,
      memorySize: 512, timeout: Duration.seconds(29), logGroup: apiLogs,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        NODE_ENV: 'production', AUTH_MODE: 'cognito', TABLE_NAME: data.table.tableName,
        COGNITO_USER_POOL_ID: data.userPool.userPoolId, COGNITO_CLIENT_ID: client.userPoolClientId,
        ARTIFACTS_BUCKET: data.artifacts.bucketName, OUTBOX_QUEUE_URL: data.outbox.queueUrl,
        CORS_ORIGINS: webOrigins.join(','), MULTI_TENANT: String(multiTenant),
        ...(!multiTenant ? { SELF_HOSTED_COMPANY_ID: props.selfHostedCompanyId! } : {}),
      },
    };
    const apiFunction = props.apiCode
      ? new lambda.Function(this, 'Api', { ...functionProps, runtime: lambda.Runtime.NODEJS_24_X, handler: 'index.handler', code: props.apiCode })
      : new nodejs.NodejsFunction(this, 'Api', {
          ...functionProps, entry: path.join(root, 'apps/api/src/lambda.ts'), handler: 'handler',
          depsLockFilePath: path.join(root, 'package-lock.json'), projectRoot: root,
          bundling: { minify: true, sourceMap: true, target: 'node24', externalModules: [], format: nodejs.OutputFormat.CJS },
        });
    data.table.grantReadWriteData(apiFunction);
    // Artifacts and queue are reserved for the accredited transport adapter; no worker or unused grants are provisioned.
    const api = new apigw.HttpApi(this, 'HttpApi', {
      createDefaultStage: false,
      corsPreflight: { allowOrigins: webOrigins, allowHeaders: ['Authorization', 'Content-Type', 'X-Company-Id', 'Idempotency-Key'], exposeHeaders: ['X-Request-Id', 'Content-Disposition', 'X-OpenFatture-Draft'], allowMethods: [apigw.CorsHttpMethod.ANY], maxAge: Duration.hours(1) },
    });
    const jwt = new authorizers.HttpUserPoolAuthorizer('CognitoJwt', data.userPool, { userPoolClients: [client] });
    const integration = new integrations.HttpLambdaIntegration('ApiIntegration', apiFunction);
    api.addRoutes({ path: '/health', methods: [apigw.HttpMethod.GET], integration });
    // An authorized ANY route also captures OPTIONS. Preflight must succeed before the browser can send its access token.
    api.addRoutes({ path: '/api/{proxy+}', methods: [apigw.HttpMethod.OPTIONS], integration, authorizer: new apigw.HttpNoneAuthorizer() });
    api.addRoutes({ path: '/api/{proxy+}', methods: [apigw.HttpMethod.ANY], integration, authorizer: jwt, authorizationScopes: ['openid'] });
    const accessLogs = new logs.LogGroup(this, 'AccessLogs', { retention: logs.RetentionDays.ONE_MONTH, encryptionKey: data.encryptionKey, removalPolicy: RemovalPolicy.RETAIN });
    new apigw.HttpStage(this, 'ApiStage', {
      httpApi: api, stageName: '$default', autoDeploy: true,
      throttle: { burstLimit: 50, rateLimit: 25 },
      accessLogSettings: { destination: new apigw.LogGroupLogDestination(accessLogs), format: restapigw.AccessLogFormat.custom(JSON.stringify({ requestId: '$context.requestId', status: '$context.status', route: '$context.routeKey', latency: '$context.responseLatency', integrationStatus: '$context.integrationStatus' })) },
    });
    new cloudwatch.Alarm(this, 'HttpServerErrors', { metric: api.metricServerError(), threshold: 5, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING });
    new cloudwatch.Alarm(this, 'ApiErrors', { metric: apiFunction.metricErrors(), threshold: 5, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING });
    new cloudwatch.Alarm(this, 'OutboxDeadLetters', { metric: data.outboxDlq.metricApproximateNumberOfMessagesVisible(), threshold: 1, evaluationPeriods: 1, treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING });
    const config = { features: { multiTenant, publicDemo: props.publicDemo ?? false }, apiBaseUrl: api.apiEndpoint, auth: { mode: 'cognito', domain: domain.baseUrl(), clientId: client.userPoolClientId, redirectUri: `${webUrl}/auth/callback`, logoutUri: `${webUrl}/` } };
    new deployment.BucketDeployment(this, 'WebDeployment', {
      sources: [deployment.Source.asset(webDirectory), deployment.Source.jsonData('config.json', config)],
      destinationBucket: web, distribution, distributionPaths: ['/*'], prune: true,
      cacheControl: [deployment.CacheControl.noCache()],
    });
    new CfnOutput(this, 'WebUrl', { value: webUrl });
    if (customDomain) new CfnOutput(this, 'CloudFrontUrl', { value: cloudFrontUrl });
    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'UserPoolId', { value: data.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'CognitoDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'TableName', { value: data.table.tableName });
    new CfnOutput(this, 'ArtifactsBucket', { value: data.artifacts.bucketName });
    new CfnOutput(this, 'OutboxQueueUrl', { value: data.outbox.queueUrl });
  }
}
