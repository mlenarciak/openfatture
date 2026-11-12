# Validation record

Checked on 12 November 2026. Initial AWS inventory was read-only; a later explicitly authorized production deployment is recorded in [deployment.md](deployment.md). No fiscal requests were sent.

| Check | Result |
| --- | --- |
| Workspace TypeScript checks | Passed for API, web, domain and infrastructure |
| API tests | 16 passed: workflow, errors, membership/role isolation, deployment flag, idempotency, concurrency and local persistence |
| Domain tests | 5 passed: fixed-point rounding, supported rates, totals and validation |
| Infrastructure assertions | 5 passed, including both deployment modes, full assembly synthesis, custom-domain DNS/TLS and canonical auth redirects |
| API and production web builds | Passed |
| Chromium browser tests | 3 passed: customer → document → draft XML → local readiness → payment → mass-service draft; mobile/keyboard/errors; bilingual documentation |
| Actual CDK CLI strict synthesis | Passed with real API/web assets in default multi-tenant and single-company modes |
| Visual inspection | Desktop and 390px mobile overview screenshots inspected |
| SMTS sources | Official page, v1.5 schema/WSDL/PDF content retrieved; checksums recorded |

`npm audit` reports no high or critical findings. Two moderate entries remain for the infrastructure toolchain's `aws-cdk-lib` and its bundled `minimatch` dependency ([advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)). The affected package is not imported by the web or API bundles. The current CDK package bundles this dependency; a normal npm override did not replace it and was removed. Recheck the advisory and update CDK when its bundled dependency is fixed. No claim of a vulnerability-free dependency tree is made.

The production web build currently produces one JavaScript chunk of about 526 KB before compression (about 159 KB gzip); Vite emits a size advisory. Route splitting can reduce initial loading cost as the application grows.

Production stacks deployed successfully. The public app, guide, SPA routes, API health endpoint and hosted Cognito login page were checked live; protected API calls without a token return 401. The browser workflow tests use explicit local demonstration mode. Authenticated production user workflows, restore drills, qualified signing, SdI accreditation/interoperability and fiscal validation have not been exercised. Initial user/company provisioning remains dependent on the operator's verified details.

Run `npm run check`, `npm run test:e2e` and `npm run infra:synth` to repeat the checks. The last command requires built web assets; browser tests require Playwright Chromium. Static app guides are published copies of `docs/guida-rapida-aziende.md` and `docs/self-hosting-and-sdi.md` in `apps/web/public`; keep the Markdown and HTML copies aligned when editing.
