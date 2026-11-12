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
| CloudFormation | `Openfatture-prod-Data`: `CREATE_COMPLETE`; `Openfatture-prod-App`: `UPDATE_COMPLETE`; `Openfatture-prod-SdiTest`: `CREATE_COMPLETE` |

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

## Isolated SdI TEST receiver

`Openfatture-prod-SdiTest` reached `CREATE_COMPLETE` at **17:17:51 UTC on 12 November 2026**. The stack name uses the deployed application's stage; the fiscal environment remains **TEST only**. The reviewed deployment added its own VPC, ALB, Fargate receiver, encrypted inbox and logs without changing the existing data or application stacks.

| Accreditation field, TEST environment | EPR |
| --- | --- |
| Reception | `https://sdi.openfatture.com/test/RicezioneFatture` |
| Transmission notifications | `https://sdi.openfatture.com/test/TrasmissioneFatture` |

Enter the service addresses without `?wsdl`. Transmission is the callback receiver for notifications, not the remote invoice-upload service. Production paths are disabled and match the ALB's fixed 403 default. That routing configuration was verified; a live HTTP production-path probe with an authorized SdI peer has not been performed.

The supplied operator certificates match their distinct original keys, and identities, TLS purposes, validity and supplied CA chains passed 35 offline checks. The server identity is imported into ACM in Milan. The incoming listener trusts only the supplied TEST CA and the receiver requires the exact reviewed SdI TEST leaf fingerprint. The operator client identity is not loaded into an outgoing sender; there is no outgoing sender in this release. Private keys and issued certificate files remain outside Git and container assets.

Live checks verified the server's chain and hostname using its supplied issuer, one healthy Fargate task and matching deployed image digest, listener mTLS VERIFY with expiry enforcement, only exact TEST POST routes, and task ingress limited to the ALB security group. Anonymous connections and the operator's own client certificate were rejected before HTTP. The isolated inbox contained zero objects. No real SdI-authenticated handshake, success acknowledgement or storage delivery has been observed; prescribed portal interoperability tests remain outstanding. No CRL is installed, so these checks do not establish revocation status.

A separate, short-lived ECS diagnostic used the same deployed image and task IAM role to write one tiny synthetic JSON marker under `test/dlt-viaggi/diagnostics/`. The SSE-KMS conditional PUT returned 200; repeating it returned 412 `PreconditionFailed`. This confirms actual storage permissions and duplicate protection. It did not exercise the SOAP receiver or use an SdI identity, and the marker is not a received invoice.

The incoming SdI TEST peer certificate expires **5 December 2026 at 10:24:02 UTC**. Obtain its replacement through the official accreditation material, verify it and deliberately rotate the pin before expiry. The server/client identities expire in November 2029; imported ACM certificates do not renew automatically. The unused remote production-server certificate in the supplied kit was expired and excluded from this TEST deployment.

The gateway's immutable deployed image digest is `sha256:67cb36a76d4f0a57a33b416cee6323d90648a34af443dcea777f66223f274c28`. Its baseline estimate is approximately **USD 45.41/month**, plus usage, KMS, logs and storage. See the [gateway runbook](../infra/SDI-TEST-GATEWAY.md) for trust rotation, retained resources, deployment context and cost sources. The receiver stores quarantined test material; it does not update company invoices, transmit documents, complete accreditation or provide compliant preservation.

The follow-up **application update completed at 17:28:30 UTC** from a separately reviewed frozen assembly. Its diff changed only the API code, paired public operator-readiness environment values, and web/documentation assets. The data stack had no differences; the healthy gateway was not redeployed. Its Docker runtime inputs still match the deployed image; build-context exclusions were subsequently tightened to omit nested local demo data and virtual environments.

Live checks passed for the canonical landing, isolated demo, draft XML download, reset/exit, mobile sign-in and actual Cognito redirect, with zero demo API calls and zero JavaScript errors. Anonymous business reads/writes return 401, permitted CORS preflight returns 204 and health returns 200. All three published guides match the reviewed local bytes. The API runs with Cognito and TEST metadata reporting server installed, endpoints deployed, interoperability not performed and production disabled. The public configuration contains no operator certificate metadata. Operator details remain restricted to an administrator with stored membership in the configured `dlt-viaggi` tenant; this deployment did not create an account or membership.
