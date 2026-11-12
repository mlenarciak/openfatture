# Product and integration review

For the current test decision, company prerequisites and executable offline checks, read [Before testing the SdI integration](sdi-integration-testing.md).

Reviewed 12 November 2026. OpenFatture is an independent implementation; Fatture in Cloud is a feature reference and optional provider, not an affiliation.

## Agenzia delle Entrate: SMTS v1.5

The [requested official page](https://www.agenziaentrate.gov.it/portale/servizi-massivi-sdicoop) was retrieved directly over HTTPS after the browser research tool returned 403. It lists InputMassivo and both technical specifications at **version 1.5, published 16 March 2026**. The old v1.4 PDF URL now returns a v1.5 document, so URL labels alone must not determine versions. Original schema/WSDL bytes and document checksums are recorded in [references/sdicoop/sources.json](references/sdicoop/sources.json).

SMTS covers bulk retrieval of invoices, corrispettivi, precompiled VAT records/returns and stamp-duty lists, plus submission of amended bollo list B. This is separate from invoice transmission and from the SDI quadratura/reinoltro services.

Accreditation and taxpayer authorization are prerequisites. A request must be signed by the taxpayer or a delegated intermediary, and the provider must be enabled through the Fatture e Corrispettivi census. A normal web application login supplies none of these prerequisites.

The download protocol is asynchronous: `inoltroRichiesta` returns a request identifier; `esitoRichiesta` reports processing; `scaricoFile` retrieves the resulting archives. The transmission service separately exposes `trasmissioneElenchi` and `esitoTrasmissione`. v1.5 adds retrieval by SdI acceptance date. Downloading certain received invoices constitutes taxpayer viewing: a future live implementation needs an explicit informed action and an audit record.

The service limits request frequency, date windows and archive availability. They belong in a provider policy layer and must be reconfirmed before live integration. The MVP saves requests as `awaiting_configuration`; it neither signs XML nor calls these services. Object storage and queues in the infrastructure are foundations, not an implemented legal archive or a running provider worker.

## Fatture in Cloud reference

The [e-invoice management guide](https://developers.fattureincloud.it/docs/guides/e-invoice-management/) separates document creation, XML verification, download, submission and rejection feedback. It requires an invoice created in Fatture in Cloud for its submission API. OpenFatture therefore keeps local preparation distinct from a future provider submission.

The [authentication guide](https://developers.fattureincloud.it/docs/basics/authentication/) recommends authorization-code OAuth for public applications; confidential credentials belong on the backend. Scopes and actual company permissions both matter. See [scopes](https://developers.fattureincloud.it/docs/basics/scopes/), [company-scoped methods](https://developers.fattureincloud.it/docs/basics/company-scoped-methods/) and the [official TypeScript SDK](https://github.com/fattureincloud/fattureincloud-ts-sdk).

The [limits guide](https://developers.fattureincloud.it/docs/basics/limits-and-quotas/) distinguishes company/app quotas, 403 quota exhaustion and 429 short-term throttling. An integration must respect Retry-After, use bounded retries with jitter and reconcile provider identifiers before retrying writes. Public-app OAuth, token rotation, webhook verification and write synchronization remain future work.

The [scadenzario guide](https://help.fattureincloud.it/help/articolo/145-scadenzario-scadenzario-plus) informed due-date tracking. The [prima nota guide](https://help-center.fattureincloud.it/help/articolo/47-prima-nota) informed payment records. These features are management aids; the app is not a complete accounting system.

## Delivered scope and follow-up

| Area | This implementation | Next production milestone |
| --- | --- | --- |
| Workspace | Company-scoped dashboard, customer registry, search/filter and CLI provisioning/membership roles | Onboarding experience, authorization audit and provider mapping |
| Documents | Draft creation, fixed-point totals, local preparation, draft XML export | Full current FatturaPA XSD/business validation and provider submission |
| Payments | Due dates, partial/full payment recording, dashboard updates | Bank reconciliation, reminders and payment-provider integration |
| SMTS | Persistent request drafts with truthful connector status | Qualified signing, consent/delegation evidence, SOAP transport, polling, archive verification |
| Fatture in Cloud | Server-side adapter foundation and readiness | Per-company OAuth, encrypted token lifecycle, mapping, webhooks and reconciliation |
| AWS | Deployed CDK application, authenticated API, durable data, object/queue foundations | Authenticated operational acceptance, fiscal adapter and recovery drills |
| Conservation | Explicitly unconfigured | Contracted compliant conservation service; S3 retention alone is insufficient |

Tax cases such as zero-rate VAT/natura, withholding, pension contributions, split payment, reverse charge, foreign counterparties and public-administration invoicing require dedicated modeling and validation before use. The initial UI supports a deliberately bounded Italian domestic workflow.
