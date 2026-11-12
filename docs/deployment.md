# Production deployment

Deployed on **12 November 2026**, in the DLT AWS account through profile `dlt`, Region `eu-south-1` (Milan).

| Component | Current value |
| --- | --- |
| Application | https://d2kr49d1pw02a7.cloudfront.net/ |
| Company guide | https://d2kr49d1pw02a7.cloudfront.net/guida.html |
| API | https://0yody6y044.execute-api.eu-south-1.amazonaws.com |
| Health | https://0yody6y044.execute-api.eu-south-1.amazonaws.com/health |
| Cognito pool | `eu-south-1_7hc8dlCAU` |
| Company table | `Openfatture-prod-Data-LedgerB7379752-XVG005IPDKFK` |
| CloudFront distribution | `E18P5ZRV3ZZWC4` |
| Deployment mode | `MULTI_TENANT=true`; production Cognito authentication |
| CloudFormation | `Openfatture-prod-Data` and `Openfatture-prod-App`, both `CREATE_COMPLETE` |

Both stacks completed through CloudFormation using the reviewed, frozen production assembly. The initial CDK bootstrap used the standard CloudFormation execution role with `AdministratorAccess`, no externally trusted accounts, and termination protection. The production data stack also has termination protection. Existing DLT application resources were not changed.

Live checks confirmed HTTP 200 for the application, both runtime configuration and guide, SPA deep links, and API health. An unauthenticated request to `/api/companies` returns HTTP 401. The deployed application opens Cognito's sign-in page with a PKCE authorization request. No demonstration data was loaded into production and no fiscal requests were sent.

## First administrator

Public self-registration is disabled. An administrator email and verified company details are still required for the first invitation and tenant provisioning. Use the [access runbook](../infra/README.md#provision-access) and [API provisioning instructions](../apps/api/README.md). Do not invent fiscal company information or treat a Cognito account alone as company membership.

## Chosen domain: openfatture.com

The requested `openfatture.it` is registered. The operator selected **openfatture.com**, which AWS reported `AVAILABLE` with standard registration and annual renewal prices of **USD 16 each**, before taxes. Route 53 DNS normally adds USD 0.50/month. Availability and quotes must be rechecked immediately before purchase.

Registration has **not** been submitted. The legal registrant choice and a contact email are pending. No registrar contact details are stored in this repository. AWS registration creates a public hosted zone automatically; reuse that zone rather than creating a duplicate.

An ACM certificate has been requested for `openfatture.com` in `us-east-1` and is `PENDING_VALIDATION`:

`arn:aws:acm:us-east-1:509581811464:certificate/1cd10045-fa13-4a9e-8cc9-18e8b0db43c4`

After registration, use the automatically created hosted zone to publish ACM's returned DNS validation CNAME. Wait for certificate issuance, then deploy the optional custom-domain context described in the [runbook](../infra/README.md#optional-custom-domain). It configures CloudFront HTTPS, Route 53 A/AAAA aliases, matching Cognito callbacks/CORS and a redirect from the CloudFront hostname to the canonical domain. Domain registration and certificate issuance are independent of the working CloudFront URL.

Sources: [AWS registration behavior and price consent](https://docs.aws.amazon.com/Route53/latest/APIReference/API_domains_RegisterDomain.html), [Route 53 pricing](https://aws.amazon.com/route53/pricing/), and the live Route 53 Domains API quote retrieved on 12 November 2026.
