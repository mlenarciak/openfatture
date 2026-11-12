import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { configFromEnvironment, createGateway, faultResponse } from './gateway.js';
import { strictBase64 } from './mime.js';
import { S3InboxStore } from './s3-store.js';
import { GatewayError, MAX_WIRE_BYTES, type GatewayRequest, type GatewayResponse } from './types.js';
export function lambdaAdapter(gateway: (request: GatewayRequest) => Promise<GatewayResponse>) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const body = event.body ? event.isBase64Encoded ? strictBase64(event.body, MAX_WIRE_BYTES, false) : Buffer.from(event.body, 'utf8') : Buffer.alloc(0);
      const certificatePem = event.requestContext.authentication?.clientCert?.clientCertPem;
      return await gateway({ method: event.requestContext.http.method, path: event.rawPath, headers: event.headers, body, peer: certificatePem ? { certificatePem, verifiedByIngress: true } : undefined });
    } catch (error) { return faultResponse(error instanceof GatewayError ? error : new GatewayError(500, 'Server', 'Receipt could not be completed; retry later')); }
  };
}
let handlerInstance: ReturnType<typeof lambdaAdapter> | undefined;
// Retained for smaller test deployments. Fargate/ALB is the full-size deployment target because Lambda events are limited to 6 MB.
export async function handler(event: APIGatewayProxyEventV2) {
  handlerInstance ??= lambdaAdapter(createGateway(new S3InboxStore(process.env.SDI_ARTIFACTS_BUCKET ?? '', process.env.SDI_KMS_KEY_ID ?? ''), configFromEnvironment(process.env)));
  return handlerInstance(event);
}
