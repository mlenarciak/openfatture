# Validation record

Checked on 12 November 2026. Initial AWS inventory was read-only; a later explicitly authorized production deployment is recorded in [deployment.md](deployment.md). No fiscal requests were sent.

| Check | Result |
| --- | --- |
| Workspace TypeScript checks | Passed for API, web, domain and infrastructure |
| API tests | 16 passed: workflow, errors, membership/role isolation, deployment flag, idempotency, concurrency and local persistence |
| Domain tests | 5 passed: fixed-point rounding, supported rates, totals and validation |
| Browser auth/demo unit tests | 24 passed: PKCE round trip and rejected states, demo storage isolation/reset, validation, payment replay, and API/download routing with no fallback or network traffic in public demo |
| Infrastructure assertions | 5 passed, including both deployment modes, full assembly synthesis, custom-domain DNS/TLS and canonical auth redirects |
| API and production web builds | Passed |
| Chromium browser tests | 8 passed: full local API workflow, public demo CRUD/download/payment/reset/isolation, sign-in callback and access-pending/error flows, feature-flag rejection, mobile/keyboard/errors, bilingual guides and SdI checklist |
| Automated accessibility checks | No WCAG 2 A/AA or 2.1 AA violations detected by axe on tested light/dark landing and demo, mobile login, client modal and mobile readiness guide; not a complete WCAG certification |
| Offline SdI contract tests | 7 passed with pinned lxml 6.1.3: source integrity, local XSD resolution, real TypeScript invoice/credit-note/mixed-VAT exports, unsafe XML rejection, SMTS input and explicit connected-test NO-GO |
| Actual CDK CLI strict synthesis | Passed with real API/web assets in default multi-tenant and single-company modes |
| Visual inspection | Public entry, login and workspace inspected on desktop/mobile and in light/dark themes |
| Official sources | SMTS v1.5 and ordinary invoice XSD v1.2.3 plus W3C signature schema retrieved; vendored bytes checked against recorded SHA256/length |

`npm audit` reports no high or critical findings; seven low/moderate entries trace to tooling dependencies: `minimatch` in CDK/ts-morph ([advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)) and `deepmerge` in the shadcn CLI/registry ([advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)). Shadcn is a development dependency; its CSS is processed at build time, and these CLI dependencies are not imported into the browser/API bundles. CDK bundles its affected minimatch copy. A compatible fixed upstream release is preferable to the destructive downgrades suggested by `audit fix --force`. No claim of a vulnerability-free dependency tree is made.

The web entry is about 387 KB before compression (125 KB gzip). Workspace forms/tables load separately (about 300 KB/84 KB gzip), with a separate browser demo adapter (15 KB/6 KB gzip). The public landing does not eagerly load the workspace. Fonts are served locally.

The updated public product was deployed successfully; the rollout is tracked in [deployment.md](deployment.md). Live Chromium checks passed for landing, anonymous demo, draft XML download, reset/exit, mobile login and the real Cognito redirect, with zero demo API requests and no JavaScript errors. Protected API calls without a token return 401; health and the published checklist return 200. The fuller browser suite exercises local API and public browser demo under simulated Cognito runtime configuration. PKCE callback success is tested with a mock identity endpoint; authenticated production user workflows, restore drills, qualified signing and SdI interoperability have not been exercised. Initial user/company provisioning remains dependent on the operator's verified details.

Offline schema validation is a structure check, not complete fiscal validation. The integration suite deliberately demonstrates an existing gap: the current app can hold an 81-character company denomination whose export fails the official 80-character XML limit. The [readiness checklist](sdi-integration-testing.md) records the remaining fiscal, transport, authority, receipt, recovery and conservation requirements. No fiscal request was sent, and the preflight intentionally refuses to mark connected testing ready.

Run `npm run check`, `npm run test:e2e`, `npm run sdi:check`, `npm run test:integration` and `npm run infra:synth` to repeat the checks. Synthesis requires built web assets; browser tests require Playwright Chromium; full offline XML tests need Python 3.10+ and `scripts/sdi-requirements.txt`. Static app guides are published copies of the three company/testing Markdown guides in `apps/web/public`; keep content aligned and preserve keyboard-focusable scrolling tables/code when regenerating them.
