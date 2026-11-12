# AWS deployment

The default target is the DLT account through profile `dlt`, Region `eu-south-1` (Milan). This creates an isolated application. It does not modify the existing DLT VPC, MySQL RDS, frontends, or the Robytour account.

Two stacks separate retained company records and identities from application code. DynamoDB has point-in-time recovery and deletion protection. S3 artifacts are private, encrypted with a rotating KMS key and versioned. SQS and a dead-letter queue are reserved for a future accredited transport adapter; this release does not consume them or claim successful SdI delivery. API mutations persist to DynamoDB with optimistic concurrency; the current bounded per-company document is a starter storage model, not a high-volume ledger.

CloudFront serves the Vite SPA from a private S3 origin with origin access control and rewrites extensionless routes to `index.html`. A generated `/config.json` points to the protected API and Cognito login. API Gateway requires an access token scope; the API independently verifies tokens and checks stored company membership. Cognito uses authorization code with PKCE, no client secret, admin-created users, short access tokens, revocation and refresh-token rotation. The browser keeps short-lived access tokens in session storage for the current tab and discards refresh tokens; sign out clears the stored token. Optional TOTP MFA can be enabled by administrators.

## Build and review

Run these from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
AWS_PROFILE=dlt AWS_REGION=eu-south-1 npm run infra:synth -- -c stage=dev
AWS_PROFILE=dlt AWS_REGION=eu-south-1 npm run infra:diff -- -c stage=dev
```

No AWS deployment was performed while generating this repository. The inspected account did not have a `CDKToolkit` stack in Milan. A deployment operator must first review bootstrap permissions and the diff. Bootstrapping and deploying create billable resources:

```sh
cd infra
AWS_PROFILE=dlt npx cdk bootstrap aws://509581811464/eu-south-1
AWS_PROFILE=dlt npm run diff -- -c stage=dev
AWS_PROFILE=dlt npm run deploy -- -c stage=dev
```

Use `-c stage=prod` for separate production stacks; the production data stack enables termination protection. Data resources are retained in both environments. Avoid renaming or moving resource construct IDs after the first deployment. The deploy writes ignored `infra/cdk-outputs.json` with the application URL, API URL, Cognito identifiers and table name. Web assets and generated configuration deploy together; no manual frontend rebuild with production identifiers is needed.

## Provision access

The pool disables public self-registration. Replace `USER_POOL_ID` with the deployment output and the example address with an independently verified operator address. Explicitly select email delivery because the [CLI defaults to SMS](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/admin-create-user.html). Set `email_verified=true` only after verifying ownership of that address:

```sh
aws cognito-idp admin-create-user --profile dlt --region eu-south-1 \
  --user-pool-id USER_POOL_ID --username admin@example.com \
  --desired-delivery-mediums EMAIL \
  --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true
aws cognito-idp admin-get-user --profile dlt --region eu-south-1 \
  --user-pool-id USER_POOL_ID --username admin@example.com \
  --query 'UserAttributes[?Name==`sub`].Value | [0]' --output text
```

Cognito sends a temporary password; the operator chooses a permanent password at first login. Use the returned `sub` and the API provisioning command documented in [apps/api/README.md](../apps/api/README.md) to create a company and grant membership. Do not use browser-supplied tenant claims as membership evidence.

The inspected Roles Anywhere identity is constrained by source IP. Run deployment from an authorized workstation, or establish a separate narrowly scoped GitHub OIDC deployment role. Do not copy this host's certificate or configure static AWS access keys in CI. This repository's CI validates and synthesizes offline; it does not deploy.

## Operations and limits

API Lambda and HTTP API access logs retain one month, encrypted with the data KMS key. Logs omit request bodies and bearer tokens. CloudWatch alarms cover API errors and dead-letter backlog; wire their alarm actions to your incident channel before production. Existing account-level CloudTrail and security controls were not audited by this bounded review.

All dynamic web responses use no-cache for predictable config and auth transitions. CSP restricts scripts to self; `connect-src` currently allows HTTPS endpoints because API and Cognito endpoints are generated during deployment. Tighten it to exact deployed origins when introducing a custom domain. There is no custom DNS, paid NAT gateway, always-on server, external provider secret, or live SdICoop channel in this deployment.

Before processing live invoices: replace the bounded company-state document with per-entity storage for anticipated volume, configure backup restore drills and alert actions, establish tenant onboarding/roles, and complete the documented SdI/provider accreditation and fiscal validation work. S3 versioning is operational storage; it does not implement compliant digital preservation.

References: [S3 origin access control](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html), [HTTP API JWT authorization](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html), [Cognito PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html), [CDK bootstrap](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html).

## Single-company self-hosting

Multi-company mode is enabled by default. To deploy an instance restricted to one company, supply a strict boolean feature flag and the same company ID used when provisioning membership:

```sh
cd infra
AWS_PROFILE=dlt npm run synth -- -c stage=dev -c multiTenant=false -c selfHostedCompanyId=my-company
AWS_PROFILE=dlt npm run diff -- -c stage=dev -c multiTenant=false -c selfHostedCompanyId=my-company
AWS_PROFILE=dlt npm run deploy -- -c stage=dev -c multiTenant=false -c selfHostedCompanyId=my-company
```

`multiTenant` accepts only `true` or `false`; disabling it without a valid `selfHostedCompanyId` fails synthesis. Both the API environment (`MULTI_TENANT`, `SELF_HOSTED_COMPANY_ID`) and `/config.json` (`features.multiTenant`) are configured by this flag. The UI hides company switching, and the API limits visible companies and rejects selection of another company. Token verification, stored company membership and role checks still apply. Provisioning and sign-in are required in either mode. To deploy the default multi-company mode, omit these context values or explicitly pass `-c multiTenant=true`.
