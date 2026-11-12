# Validation record

Checked on 12 November 2026. Initial AWS inventory was read-only; a later explicitly authorized production deployment is recorded in [deployment.md](deployment.md). No fiscal requests were sent.

| Check | Result |
| --- | --- |
| Workspace TypeScript checks | Passed for API, SdI TEST gateway, web, domain and infrastructure |
| API tests | 33 passed: workflow, membership/role isolation, deployment flag, idempotency, concurrency, local persistence, operator-readiness authorization and 12 synthetic PKI verifier cases |
| Domain tests | 5 passed: fixed-point rounding, supported rates, totals and validation |
| Browser auth/demo unit tests | 29 passed: PKCE, isolated demo, validation, payment replay, API/download routing, protected SdI status presentation and peer-expiry warnings |
| Infrastructure assertions | 8 passed: both deployment modes, custom-domain/auth routing, protected metadata, TEST gateway IAM, networking and trust constraints |
| SdI gateway tests | 42 passed: eight SOAP operations, pinned source hashes, inline/MTOM payloads, full-size attachments, XML/MIME attacks, peer identity, duplicate delivery and storage failure handling |
| API, production web and SdI gateway builds | Passed; real frozen Docker build and non-root/read-only constrained container smoke also passed |
| Chromium browser tests | 11 passed across the existing eight workflows and three new operator-readiness scenarios: clipboard EPRs, expiry states, scoped metadata, mobile layout and light/dark accessibility |
| Automated accessibility checks | No WCAG 2 A/AA or 2.1 AA violations detected by axe on tested light/dark landing and demo, mobile login, client modal, mobile readiness guide and operator status including the expired-peer warning; not a complete WCAG certification |
| Offline SdI contract tests | 7 passed with pinned lxml 6.1.3: source integrity, local XSD resolution, real TypeScript invoice/credit-note/mixed-VAT exports, unsafe XML rejection, SMTS input and explicit connected-test NO-GO |
| Actual CDK CLI strict synthesis | Passed with real API/web assets in default multi-tenant and single-company modes |
| Visual inspection | Public entry, login and workspace inspected on desktop/mobile and in light/dark themes |
| Official sources | SMTS v1.5 and ordinary invoice XSD v1.2.3 plus W3C signature schema retrieved; vendored bytes checked against recorded SHA256/length |

`npm audit` reports no high or critical findings; seven low/moderate entries trace to tooling dependencies: `minimatch` in CDK/ts-morph ([advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)) and `deepmerge` in the shadcn CLI/registry ([advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)). Shadcn is a development dependency; its CSS is processed at build time, and these CLI dependencies are not imported into the browser/API bundles. CDK bundles its affected minimatch copy. A compatible fixed upstream release is preferable to the destructive downgrades suggested by `audit fix --force`. No claim of a vulnerability-free dependency tree is made.

The web entry is about 387 KB before compression (125 KB gzip). Workspace forms/tables load separately (about 312 KB/87 KB gzip), with a separate browser demo adapter (15 KB/6 KB gzip). The public landing does not eagerly load the workspace. Fonts are served locally.

The updated public product was deployed successfully; the rollout is tracked in [deployment.md](deployment.md). Live Chromium checks passed for landing, anonymous demo, draft XML download, reset/exit, mobile login and the real Cognito redirect, with zero demo API requests and no JavaScript errors. Protected API calls without a token return 401; health and the published checklist return 200. The fuller browser suite exercises local API and public browser demo under simulated Cognito runtime configuration. PKCE callback success is tested with a mock identity endpoint; authenticated production user workflows, restore drills, qualified signing and SdI interoperability have not been exercised. Initial user/company provisioning remains dependent on the operator's verified details.

Offline schema validation is a structure check, not complete fiscal validation. The integration suite deliberately demonstrates an existing gap: the current app can hold an 81-character company denomination whose export fails the official 80-character XML limit. The [readiness checklist](sdi-integration-testing.md) records the remaining fiscal, transport, authority, receipt, recovery and conservation requirements. No fiscal request was sent, and the preflight intentionally refuses to mark connected testing ready.

Run `npm run check`, `npm run test:e2e`, `npm run sdi:check`, `npm run test:integration` and `npm run infra:synth` to repeat the checks. Synthesis requires built web assets; browser tests require Playwright Chromium; full offline XML tests need Python 3.10+ and `scripts/sdi-requirements.txt`. Static app guides are published copies of the three company/testing Markdown guides in `apps/web/public`; keep content aligned and preserve keyboard-focusable scrolling tables/code when regenerating them.

## Custom-domain and API preflight verification

On 12 November 2026, the canonical application moved to **https://openfatture.com**. Live Chromium checks passed for the landing page, isolated browser demo, draft XML download, reset/exit, mobile login, guides and hosted Cognito sign-in. Callback/logout configuration uses the canonical origin; the old CloudFront hostname redirects while preserving encoded and repeated callback query parameters. The demo generated zero production API requests and there were no browser JavaScript errors.

The rollout exposed a gateway route-selection issue: the JWT-protected ANY route also captured browser OPTIONS requests. A focused fix added an explicit unauthenticated OPTIONS route while retaining JWT plus `openid` on business methods. Infrastructure typecheck and the existing five infrastructure tests passed with new assertions for both default and custom-domain configurations. Strict synthesis and live diff review confirmed only the route and its invocation permission were added; the data stack and every existing application resource were unchanged.

After the fix deployed, an allowed-origin preflight with `authorization`, `x-company-id` and `idempotency-key` returned 204 and the correct allow-origin/header response. An untrusted origin received no permissive allow-origin header. Unauthenticated business GET and POST requests returned 401; health returned 200. These checks did not authenticate a production user or send fiscal data. The broader application/unit suites were not rerun for this focused infrastructure fix.

## Certificate and TEST gateway verification

The final workspace check passed **117 tests**, all TypeScript checks and all builds. The seven offline XML tests and eight existing Chromium workflows passed again; the three new Chromium tests cover the protected readiness view using mocked Cognito/API responses and synthetic certificate data. Browser testing found and fixed a destructive-alert contrast issue and a narrow-screen heading layout problem. No real user token or certificate identity was included in those fixtures or screenshots.

The read-only verifier passed **35 checks** against the supplied real certificate/CA files and original keys. It validated distinct keys, identities, validity, TLS purposes, CA self-signatures and supplied chains. It did not check revocation or change the supplied files. No private key or issued certificate is stored in Git.

The reviewed frozen gateway container was built and run locally as uid 1000, with a read-only filesystem, no network, 512 MiB memory and 0.25 CPU. Its internal health check returned 200, production routes were disabled and a test request without a verified peer returned 403. The deployed AWS task digest matched that build.

After CloudFormation completed, the target was healthy and the listener's narrow TEST trust, expiry enforcement, exact TEST POST routes, production default rejection, private encrypted inbox and ALB-only task ingress were verified through AWS APIs. Live TLS validated the server chain/hostname; missing certificates and the operator client identity were rejected before HTTP. These negative checks do not establish a successful authenticated SdI handshake, ACK or receipt. The first authorized exchange must come from the SdI test system; the client private key owned by SdI is neither requested nor available locally. No CRL is installed. The application reports interoperability as not performed and production as disabled.

One isolated ECS diagnostic with the deployed image and receiver task role confirmed an actual conditional SSE-KMS write: first PUT 200, duplicate 412 `PreconditionFailed`. The only object was a tiny synthetic marker under the diagnostic prefix; there was no SOAP request, SdI identity, acknowledgement or business-record mutation. This validates storage permissions independently from the still-pending authenticated portal exchange.

The application update completed at 17:28:30 UTC. Post-deployment Chromium checks passed for the canonical domain, public demo, draft XML download, reset/exit, mobile login and actual Cognito redirect with zero JavaScript errors and zero demo API calls. API health was 200, anonymous business methods 401 and allowed preflight 204. Public guide bytes match source. The deployed Lambda's protected readiness configuration matches the intended TEST-only state, while public runtime configuration excludes certificate metadata. No real operator login was performed; membership enforcement is covered by API tests and the UI by synthetic browser fixtures.

Final asset inspection caught nested local demo data in a proposed future container context. Both Docker/CDK exclusions now omit nested `.data` and virtual environments; the newly staged context was inspected and contained no local data, certificate or key files. The existing deployed context did not contain the demo file, and the corrected context's Dockerfile, package manifests/lockfile and receiver source are byte-identical to the deployed runtime inputs. Infrastructure assertions passed again after this exclusion-only correction.
