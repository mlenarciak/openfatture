import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import type { ImmutableObject, InboxStore } from './types.js';
export class S3InboxStore implements InboxStore {
  private client: Pick<S3Client, 'send'>;
  constructor(private bucket: string, private kmsKeyId: string, client?: Pick<S3Client, 'send'>) {
    if (!bucket || !kmsKeyId) throw new Error('SDI_ARTIFACTS_BUCKET and SDI_KMS_KEY_ID are required');
    this.client = client ?? new S3Client({ maxAttempts: 3, requestHandler: { connectionTimeout: 5_000, socketTimeout: 15_000 } });
  }
  async putImmutable(object: ImmutableObject): Promise<void> {
    if (!object.key.startsWith('test/') || object.key.includes('..')) throw new Error('Only test inbox keys are permitted');
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: object.key, Body: object.data, ContentType: object.contentType, IfNoneMatch: '*', ServerSideEncryption: 'aws:kms', SSEKMSKeyId: this.kmsKeyId, ChecksumSHA256: createHash('sha256').update(object.data).digest('base64') }));
    } catch (error) {
      // The immutable key includes the content digest; an already-existing object is an idempotent success.
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412 && (error as { name?: string }).name === 'PreconditionFailed') return;
      throw error;
    }
  }
}
