import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';
export type Identity = { subject: string };
export type Authenticate = (request: FastifyRequest) => Promise<Identity>;
export function authenticator(env: NodeJS.ProcessEnv): Authenticate {
  const mode = env.AUTH_MODE ?? (env.NODE_ENV === 'production' ? 'cognito' : 'demo');
  if (mode === 'demo') {
    if (env.NODE_ENV === 'production' || env.AWS_LAMBDA_FUNCTION_NAME) throw new Error('Demo authentication is forbidden in production/Lambda');
    return async () => ({ subject: 'demo' });
  }
  if (mode !== 'cognito' || !env.COGNITO_USER_POOL_ID || !env.COGNITO_CLIENT_ID) throw new Error('Configure AUTH_MODE=cognito, COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID');
  const verifier = CognitoJwtVerifier.create({ userPoolId: env.COGNITO_USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID, tokenUse: 'access' });
  return async request => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in to continue');
    try { const claims = await verifier.verify(authorization.slice(7)); return { subject: claims.sub }; }
    catch { throw new HttpError(401, 'UNAUTHORIZED', 'Invalid or expired access token'); }
  };
}
