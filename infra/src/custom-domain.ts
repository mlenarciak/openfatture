/** Existing DNS and TLS resources are imported; domain registration stays a separate operation. */
export interface CustomDomain {
  domainName: string;
  hostedZoneId: string;
  certificateArn: string;
}

export function deploymentCustomDomain(domainContext: unknown, zoneContext: unknown, certificateContext: unknown): CustomDomain | undefined {
  const supplied = [domainContext, zoneContext, certificateContext].filter(value => value !== undefined).length;
  if (supplied === 0) return undefined;
  if (supplied !== 3) throw new Error('domainName, hostedZoneId and certificateArn must be supplied together');
  if (typeof domainContext !== 'string' || domainContext.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(domainContext)) {
    throw new Error('domainName must be a fully qualified DNS name without scheme, wildcard, port or trailing dot');
  }
  if (typeof zoneContext !== 'string' || !/^Z[A-Z0-9]{1,32}$/.test(zoneContext)) throw new Error('hostedZoneId must be a Route 53 hosted zone ID beginning with Z');
  if (typeof certificateContext !== 'string' || !/^arn:aws:acm:us-east-1:[0-9]{12}:certificate\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(certificateContext)) {
    throw new Error('certificateArn must reference an ACM certificate in us-east-1 for CloudFront');
  }
  return { domainName: domainContext.toLowerCase(), hostedZoneId: zoneContext, certificateArn: certificateContext };
}
