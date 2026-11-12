import { Duration, RemovalPolicy, Stack, type StackProps, aws_cognito as cognito, aws_dynamodb as dynamodb, aws_kms as kms, aws_s3 as s3, aws_sqs as sqs } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export class DataStack extends Stack {
  readonly table: dynamodb.Table;
  readonly artifacts: s3.Bucket;
  readonly outbox: sqs.Queue;
  readonly outboxDlq: sqs.Queue;
  readonly userPool: cognito.UserPool;
  readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    this.encryptionKey = new kms.Key(this, 'DataKey', { enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN, description: 'Openfatture data encryption' });
    this.table = new dynamodb.Table(this, 'Ledger', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.artifacts = new s3.Bucket(this, 'Artifacts', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, enforceSSL: true, versioned: true,
      encryption: s3.BucketEncryption.KMS, encryptionKey: this.encryptionKey, bucketKeyEnabled: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.outboxDlq = new sqs.Queue(this, 'OutboxDeadLetters', {
      retentionPeriod: Duration.days(14), encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.encryptionKey, enforceSSL: true, removalPolicy: RemovalPolicy.RETAIN,
    });
    this.outbox = new sqs.Queue(this, 'Outbox', {
      visibilityTimeout: Duration.minutes(3), retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS, encryptionMasterKey: this.encryptionKey,
      enforceSSL: true, deadLetterQueue: { queue: this.outboxDlq, maxReceiveCount: 5 },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.userPool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false, signInAliases: { email: true },
      autoVerify: { email: true }, accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL, mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: { minLength: 14, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true, tempPasswordValidity: Duration.days(3) },
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
