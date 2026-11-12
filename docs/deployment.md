# Production deployment

Deployed on **12 November 2026**, in the DLT AWS account through profile `dlt`, Region `eu-south-1` (Milan).

| Component | Current value |
| --- | --- |
| Application | https://openfatture.com/ |
| Public demo | https://openfatture.com/demo — no account required |
| Company sign-in | https://openfatture.com/login |
| Company guide | https://openfatture.com/guida.html |
| SdI testing checklist | https://openfatture.com/sdi-integration-testing.html |
| API | https://0yody6y044.execute-api.eu-south-1.amazonaws.com |
| Health | https://0yody6y044.execute-api.eu-south-1.amazonaws.com/health |
| Cognito pool | `eu-south-1_7hc8dlCAU` |
| Company table | `Openfatture-prod-Data-LedgerB7379752-XVG005IPDKFK` |
| CloudFront distribution | `E18P5ZRV3ZZWC4` |
| Deployment mode | `MULTI_TENANT=true`; production Cognito authentication; public browser demo enabled |
| CloudFormation | `Openfatture-prod-Data`: `CREATE_COMPLETE`; `Openfatture-prod-App`: `UPDATE_COMPLETE` |

Both stacks completed through CloudFormation using the reviewed, frozen production assembly. The initial CDK bootstrap used the standard CloudFormation execution role with `AdministratorAccess`, no externally trusted accounts, and termination protection. The production data stack also has termination protection. Existing DLT application resources were not changed.

Live checks confirmed HTTP 200 for the application, both runtime configuration and guide, SPA deep links, and API health. An unauthenticated request to `/api/companies` returns HTTP 401. The deployed application opens Cognito's sign-in page with a PKCE authorization request. No demonstration data was loaded into production and no fiscal requests were sent.

## Public product update

Updated on 12 November 2026 with the shadcn neutral/purple theme, square corners, light/dark mode, public landing page, explicit sign-in entry and browser-only demo. The reviewed CloudFormation diff changed only `WebDeployment` asset/configuration keys. The retained data stack, API, Cognito settings and IAM permissions had no changes. Deployed from the frozen production assembly with `-c stage=prod -c publicDemo=true`.

The demo stores synthetic examples in each tab's session storage. Client/document creation, draft XML download, payment recording and reset operate without production API requests. Starting the demo clears the tab's existing access token; it does not create an account or company. Cognito membership is still required for real company data. The flag defaults to disabled for new self-hosted installations; include `-c publicDemo=true` on subsequent deployments of this public instance.

Live Chromium smoke checks passed after rollout: public entry, anonymous demo, XML download, reset/exit, mobile sign-in layout and the real hosted Cognito login page. Demo activity generated **zero API requests** and there were no browser JavaScript errors. Protected API access still returned 401, health and the public testing guide returned 200. No production user login or fiscal transmission was performed.

Local validation passed 50 unit/API/domain/infrastructure tests, eight Chromium workflows/accessibility checks, and seven offline SdI contract tests with pinned lxml. The full scope and remaining limits are recorded in [validation.md](validation.md). SdI/provider transmission, receipt handling, qualified signing and compliant preservation remain outside this release; see the public testing checklist.

## First administrator

Public self-registration is disabled. An administrator email and verified company details are still required for the first invitation and tenant provisioning. Use the [access runbook](../infra/README.md#provision-access) and [API provisioning instructions](../apps/api/README.md). Do not invent fiscal company information or treat a Cognito account alone as company membership.

## Registered domain: openfatture.com

**openfatture.com is registered in the DLT AWS account.** Route 53 Domains completed registration operation `9a4769e4-32d2-4de4-b73f-eed9de188c62` on 12 November 2026 for one year at **USD 16**. The domain expires on **12 November 2027**; automatic renewal and registrar contact privacy are enabled. The legal registrant is DLT Viaggi S.r.l. No private address, phone number or registrar contact details are stored in this repository.

**Registrant email reachability verification remains pending:** the authorized contact must follow the verification link in the registrar's email. Successful registration does not replace that separate confirmation.

The automatically created public hosted zone is `Z0205029353SA9C8BO1GN`. Its ACM DNS-validation CNAME is published; retain it for certificate validation and renewal. Do not create a duplicate hosted zone.

ACM issued the `openfatture.com` certificate in **us-east-1**, valid through **29 May 2027**:

`arn:aws:acm:us-east-1:509581811464:certificate/1cd10045-fa13-4a9e-8cc9-18e8b0db43c4`

The reviewed custom-domain CloudFormation update completed at **15:41:45 UTC on 12 November 2026**. CloudFront reports `Deployed`, uses the issued certificate and `TLSv1.2_2021` minimum policy, and serves the apex through Route 53 A/AAAA aliases. The generated web configuration, Cognito callback/logout origins and API CORS use the canonical domain. The retained data stack had no changes.

The previous hostname, `https://d2kr49d1pw02a7.cloudfront.net`, now redirects to `https://openfatture.com` before the app loads. Live checks verified preservation of the callback path and encoded/repeated query parameters, so PKCE sign-in starts and returns on the same canonical origin.

A subsequent focused update completed at **15:46:03 UTC** to allow unauthenticated browser preflight on `OPTIONS /api/{proxy+}`. The existing `ANY /api/{proxy+}` business route retains JWT authentication and the `openid` access-token scope. The reviewed diff added only the OPTIONS route and its API Gateway-to-Lambda invocation permission; it changed no existing resource, data, role, Cognito setting, DNS record, frontend asset or certificate.

Live Chromium checks on the canonical domain passed: home, `/demo`, `/login`, both company guides, the SdI checklist, synthetic draft XML download, reset/exit and mobile sign-in. The browser demo made **zero production API calls** and reported no JavaScript errors. Cognito's login request uses `https://openfatture.com/auth/callback`. Allowed-origin preflight returns **204** with authorization, company and idempotency headers allowed; an untrusted origin receives no permissive allow-origin response. Anonymous GET and POST business requests still return **401**, and API health returns **200**. No production user login, tenant mutation or fiscal transmission was performed.

Keep `stage=prod`, `publicDemo=true`, and all three domain context values on subsequent deployments, as described in the [custom-domain runbook](../infra/README.md#optional-custom-domain). Domain registration, its contact verification and the application deployment are separate operations.

The requested `openfatture.it` is already registered. The operator selected `openfatture.com` after AWS quoted standard registration and annual renewal prices of USD 16 each. Route 53 DNS normally adds USD 0.50/month for a public hosted zone; other service usage and applicable taxes are separate.

Sources: [AWS registration behavior](https://docs.aws.amazon.com/Route53/latest/APIReference/API_domains_RegisterDomain.html), [Route 53 pricing](https://aws.amazon.com/route53/pricing/), and the live Route 53 Domains registration/price results retrieved on 12 November 2026.
