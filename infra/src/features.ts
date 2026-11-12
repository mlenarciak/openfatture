export function deploymentFeatures(multiTenantContext: unknown, companyContext: unknown) {
  const raw = multiTenantContext ?? true;
  if (raw !== true && raw !== false && raw !== 'true' && raw !== 'false') throw new Error('multiTenant must be true or false');
  const multiTenant = raw === true || raw === 'true';
  const selfHostedCompanyId = typeof companyContext === 'string' ? companyContext : undefined;
  if (!multiTenant && (!selfHostedCompanyId || !/^[a-zA-Z0-9_-]{1,80}$/.test(selfHostedCompanyId))) {
    throw new Error('single-company mode requires selfHostedCompanyId (1-80 letters, digits, underscore or hyphen)');
  }
  return { multiTenant, selfHostedCompanyId };
}
