# Before testing the SdI integration

**Decision on 12 November 2026: GO for offline checks; NO-GO for connecting this release to SdI, SMTS or a Fatture in Cloud send workflow.** The public demonstration and successful AWS deployment test the application. They do not establish channel accreditation, taxpayer authorization or fiscal correctness.

This guide tells the company administrator what to prepare and gives developers a test plan. Nobody needs to share SPID credentials, private keys, signing PINs or provider tokens in a support conversation. Keep those in the operator's approved credential system. Portal steps are based on current public documentation; private portal screens and this company's accreditation were not inspected.

## Choose the integration you intend to test

| Route | What happens | What OpenFatture currently implements |
| --- | --- | --- |
| Direct SdICoop invoice transmission | Your accredited channel sends invoice files to SdI and receives asynchronous notifications | Draft XML export; no SOAP sender, certificates, callbacks or receipt processing |
| Direct SdICoop invoice reception | SdI calls your accredited receiving endpoint with invoice files and metadata | No inbound invoice endpoint or import pipeline |
| SMTS mass services over SdICoop | An enabled provider submits signed requests, polls results and downloads archives; amended bollo list B is a separate transmission flow | Local request records with `awaiting_configuration`; no signed request or remote operation |
| Fatture in Cloud as provider | Your connector creates/maps provider documents, verifies them and synchronizes results | Optional administrator-only company listing, pinned to one local tenant; no document writes or send simulation |

A normal invoice send is **not** `inoltroRichiesta`. That operation belongs to SMTS. Likewise, `trasmissioneElenchi` concerns amended stamp-duty lists, not transmission of ordinary invoices. SdI quadratura/reinoltro is another set of services. The [SMTS documentation](https://www.agenziaentrate.gov.it/portale/servizi-massivi-sdicoop) and [SdICoop manuals](https://www.fatturapa.gov.it/it/norme-e-regole/DocumentazioneSDI/) describe separate contracts.

## What the company must do

### If using Fatture in Cloud or another accredited provider

1. Choose the actual provider and confirm its company account, API permissions, plan and supported test workflow. A provider's accredited channel does not give OpenFatture an API connector automatically.
2. Identify the legal taxpayer, its Partita IVA and the person authorized to grant the provider access. Confirm that the provider company ID maps to the same taxpayer; it is different from an OpenFatture company ID or a Cognito user ID.
3. Authorize the integration with the required provider scopes and company permissions. A server-wide token must not become a shared credential for unrelated tenants.
4. Agree a non-fiscal test boundary with the provider. Fatture in Cloud documents `options.dry_run=true` for send simulation; its trial is a standard account, and sending requires a paid plan. Do not treat omitted or false `dry_run` as a harmless test. [Provider test options](https://developers.fattureincloud.it/docs/guides/e-invoice-management/), [account and plan rules](https://developers.fattureincloud.it/docs/developer-account/).
5. For receiving invoices, obtain the provider's seven-character code and register it for the taxpayer in Fatture e Corrispettivi. Coordinate the cutover and reception test. Registration changes a real delivery preference; do not change it just to run an offline test.

Fatture in Cloud cannot submit OpenFatture's exported XML as-is. A future connector must create the provider document through supported APIs and retain the provider's identifiers before verification or simulation. Historical XML import is not a sending route. [External XML rules](https://developers.fattureincloud.it/docs/guides/externally-generated-xml/).

### If operating a direct SdI channel

1. Confirm the company's Entratel/Fisconline registration and the authorized Gestore/Incaricato. In the Agenzia reserved area, the Gestore can enable **Accreditamento e gestione dei canali trasmissivi** under **Il tuo Profilo → Incarichi → Gestisci incarichi come gestore → Gestisci Servizi**. See [SA guide v2.0](https://www.fatturapa.gov.it/export/documenti/guide/Guida-SA_v2.0.pdf).
2. Select the correct taxpayer in [Sistema di Accreditamento](https://accreditamento.fatturapa.gov.it/). Appoint the agreement contact and technical operators. Record whether the WS channel is for sending, receiving or both.
3. Have IT implement the interfaces, register callback endpoints and obtain/manage channel certificates through the current CSR workflow. Agree exact test endpoints and trust material with the accreditation system. Never infer a test hostname from a production hostname.
4. Run the prescribed interoperability cases. The official process may use six-character PA test codes and PA notification cases even for an eventual B2B channel. These are channel tests, not proof that every fiscal case in the app is correct.
5. After successful tests, review/accept the service agreement and request production activation. Request a seven-character B2B recipient code for an activated receiving channel, then register the taxpayer's receiving address separately. A sending-only WS channel cannot obtain a receiving code; SFTP accreditation is bidirectional. [Current accreditation process](https://www.fatturapa.gov.it/it/SistemaAccreditamento/processo-per-nuovo-accreditamento/).

For SMTS, additionally verify the intended services and enable the provider for each taxpayer under **Fatture e Corrispettivi → Consultazione → Censimento canali per forniture massive**. Obtain the relevant intermediary delegation where needed. Arrange qualified signing by the taxpayer or delegated intermediary. An application membership, channel certificate and portal delegation establish different permissions.

## Credentials and endpoints IT must distinguish

| Item | Purpose | Required evidence before a connected test |
| --- | --- | --- |
| Cognito login and app membership | Access to this company's OpenFatture records | Correct user subject, company and role; cross-company requests denied |
| FIC OAuth grant/token | Access to provider resources | Explicit local company ↔ provider company ↔ VAT mapping, valid scopes, lifecycle and revocation |
| SdICoop client identity and trust chain | Certificate-authenticated transport to SdI/SMTS | Test activation, certificate/key match, expiry/revocation/renewal, approved endpoint and TLS settings |
| Public receiving/callback service | Allows SdI to deliver files and notifications | Registered reachable HTTPS SOAP endpoint; validates the authorized peer and persists before acknowledging |
| SMTS qualified signature | Signs the request in the capacity of taxpayer or delegate | Correct signer, qualified certificate and delegation, accepted CAdES/XAdES profile; independent of TLS identity |
| Public web TLS certificate | Protects the browser site | Valid DNS and server certificate; this alone is not channel accreditation or request signing |

For invoice transmission, `SdIRiceviFile` is exposed by SdI; the transmitter exposes `TrasmissioneFatture` for messages. For receiving, the recipient exposes `RicezioneFatture`; `SdIRiceviNotifica` handles the PA-specific response path. Current channel rules specify TLS 1.2 and SOAP attachments/MTOM with certificate-based authentication. [Transmission manual v3.3](https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v3.x/Istruzioni-per-il-servizio-SDICoop-Trasmissione-versione3.3.pdf), [reception manual v3.3](https://www.fatturapa.gov.it/export/documenti/ws/ricezione/v3.x/Istruzioni-per-il-servizio-SDICoop-Ricezione-versione3.3.pdf), [channel rules v1.8.4](https://www.fatturapa.gov.it/export/documenti/Specifiche-tecniche-relative-al-Sistema-di-Interscambio-versione-1.8.4.pdf).

The deployed `/api/*` routes require a Cognito token and accept business JSON; they are not these SOAP endpoints. A future callback path needs its own verified transport/provider authentication, payload handling and tenant resolution. Do not disable authentication across the business API to make a callback reachable. Do not trust an inbound `X-Company-Id` header to route fiscal data.

## Implementation blockers to close

These findings come from the current [API](https://github.com/mlenarciak/openfatture/blob/main/apps/api/src/app.ts), [XML exporter](https://github.com/mlenarciak/openfatture/blob/main/apps/api/src/xml.ts), [domain contracts](https://github.com/mlenarciak/openfatture/blob/main/packages/domain/src/index.ts) and infrastructure. They are implementation findings, not statements that the Agenzia has rejected a test.

- [ ] **Define and implement the selected adapter.** There is no invoice SOAP transport, receiving service, notification processor, SMTS worker or FIC document connector. The infrastructure's SQS/S3 resources are reserved foundations with no fiscal consumer.
- [ ] **Freeze the fiscal document.** Keep immutable seller/buyer data, numbering/series, document version, approved XML bytes, hash, transmission filename and unique sending progressive. The current export downloads `DRAFT-<id>.xml`; that filename is intentionally not a transmission contract. Current draft numbering and `/issue` do not establish legal issuance.
- [ ] **Enforce fiscal validation before enqueueing.** The exporter supports ordinary domestic `FPR12`, `TD01` and `TD04`; quotes correctly fail export. Current field limits are application limits, not all XSD limits: for example, business names allow 160 characters while the invoice schema's denomination is shorter. Address limits, XML control characters, taxpayer validity, routing, dates and totals need validation against the selected profile and business rules.
- [ ] **Model supported tax cases explicitly.** Only positive taxable VAT rates 4/5/10/22 are modeled. No zero-rate/Natura, reverse charge, withholding, pension funds, split payment, foreign counterparties, PA-specific fields or simplified invoices are implemented. Do not silently approximate these cases. Ordinary private-invoice signing rules differ from PA and SMTS: qualified signing of every SMTS request is not a reason to assume every B2B invoice must be signed. [B2B rules v1.9.1](https://www.agenziaentrate.gov.it/portale/documents/d/guest/allegato-a-specifiche-tecniche-vers-1-9-1).
- [ ] **Separate business, transport and payment states.** `/issue` changes `draft` to local `ready`. `paid` is a local payment result. Neither proves SdI acceptance or delivery. Add transmission attempt/unknown result, accepted-by-transport, rejected, delivered, unavailable-for-delivery and applicable PA events separately; preserve raw receipts and their provenance.
- [ ] **Make submission recovery safe.** Atomically persist the immutable snapshot and outbox intent; assign tenant-scoped idempotency and correlation identifiers; reconcile an ambiguous timeout before retrying a send. Payment idempotency and aggregate optimistic concurrency already exist but do not deduplicate fiscal submissions or callbacks. Current company aggregates have a 350 KB ceiling and are unsuitable for bulk invoice/archive storage.
- [ ] **Bind legal authority to each operation.** Map local company, taxpayer VAT/CF, provider/channel, receiving code and signer/delegation evidence. Scope all jobs, archive IDs, webhook subscriptions and receipt lookups to that mapping. Test expired/revoked/mismatched authorization and quarantine unresolvable inbound documents.
- [ ] **Implement trusted ingestion and reconciliation.** Verify the channel peer or provider notification token, safely parse XML/attachments, enforce size limits, deduplicate events and handle late/out-of-order receipts. FIC uses its own signed notification token, not a Cognito access token; subscription verification, expiry and re-fetch of authoritative resource state also require implementation. [FIC notifications](https://developers.fattureincloud.it/docs/webhooks/notifications/).
- [ ] **Complete SMTS policy and signing.** Current jobs contain only type/date fields; there is no inner payload, signed wrapper, service-specific options, qualified signer, provider request ID or result list. The generic dates cannot select emission, reception or v1.5 SdI acceptance-date semantics. `receipt_download` currently denotes a local corrispettivi request, not SdI delivery receipts. Stamp-duty downloads and modified list-B submission need separate contracts.
- [ ] **Agree conservation and operations.** Define the preservation service, responsibility and evidence, access/audit retention, recovery and escalation. S3 versioning and database backups do not implement compliant conservation.

## Test phases and acceptance evidence

Existing tests provide an application baseline. Rows marked **missing** describe tests to build before connecting the adapter; they have not passed merely because they appear here.

| Phase | Test and expected result | Current evidence / gate |
| --- | --- | --- |
| 0 · offline provenance | Bundled sources match SHA256/length; WSDL operations match the selected SMTS service | `scripts/sdi-preflight.py`; executable now |
| 0 · XML structure | Compile exact invoice/SMTS schemas without network; validate synthetic invoice and inner request; reject unsafe XML, wrong namespaces and broken payloads | `tests/integration/test_sdi_preflight.py`; structural checks only |
| 0 · application | Draft → local readiness → payment; quote XML denied; errors retain draft marker; company/role isolation; idempotent payment replay | `apps/api/test/api.test.ts`, `apps/api/test/store.test.ts`, `packages/domain/test/calculations.test.ts` |
| 0 · fiscal edge cases | TD01/TD04 with mixed VAT, quantity rounding, long/illegal fields, routing codes, fiscal numbering and totals; unsupported tax profiles fail before sending | Partial arithmetic/application coverage; complete business-rule suite **missing** |
| 1 · mocked adapter | Correct SOAP/MTOM or provider JSON; response correlation; 401/403, 429/Retry-After, SOAP fault, timeouts and duplicate/out-of-order notifications | Adapter and fixtures **missing**; no external credentials needed to build them |
| 1 · recovery/isolation | Crash after intent/before send/after remote acceptance; replay delivers one logical submission; malicious/foreign callback cannot modify another taxpayer | Fiscal outbox, inbox and reconciliation tests **missing** |
| 2 · channel/test environment | Prove approved test endpoint, certificates/peer trust, network reachability and registered callback; complete prescribed interoperability cases and inspect captured receipts | **NO-GO now**; direct-channel implementation and company evidence required |
| 2 · provider simulation | Map FIC company/document, create/verify through provider APIs, then explicitly use `options.dry_run=true`; record IDs without fiscal delivery | **NO-GO now**; document adapter and approved provider account needed |
| 2 · SMTS | Verify signed wrapper plus inner input, authorized taxpayer, provider ID, asynchronous status, empty/error/multi-archive result and informed viewing action | **NO-GO now**; confirm available test facility and dataset with the accredited provider/Agenzia; a normal SMTS production URL is not a sandbox |
| 3 · controlled live pilot | Separately approved real taxpayer/document, completed prior phases, monitored receipts and reconciliation, conservation handoff and contingency owner | **NO-GO now**; channel test completion does not itself authorize a live fiscal invoice |

A test record should contain the environment, source versions, case ID, code revision, masked taxpayer reference, expected/actual state, immutable payload/receipt hashes, correlation IDs, time and reviewer. Store payloads and certificates in the appropriate protected system, not Git or public screenshots. Record whether a result was simulated, channel-test traffic, or fiscal production traffic.

### SMTS-specific tests and limits

Test `inoltroRichiesta → esitoRichiesta → scaricoFile`, including `ST00` (not available to that provider), `ST01` (processing), `ST02` (rejected) and `ST03` (processed with result list). Test the v1.5 `FattureDataAcc/DataAccoglienza` branch as well as emission/reception dates and the separate list-B transmission/result path. Enforce the published request/poll/download limits and archive deadlines in policy code; the app's maximum 90-day draft window is not the official three-calendar-month rule. Exercise wrong signer/delegation, duplicate request, provider not enabled, no results, multiple archives, corrupt archive, path traversal and excessive decompression.

**Before the first attempt to download an invoice archive**, present and record the authorized viewing decision: the official service records presa visione for documents in that archive on the first download attempt. A failed local save must not cause the app to claim that no viewing occurred. Persist archive identities/checksums and restart safely. [SMTS technical instructions v1.5](https://www.agenziaentrate.gov.it/portale/documents/20143/5748669/Servizi_Massivi_Specifiche_Tecniche_v1.5.pdf/f1734d20-d179-eb0a-7a2d-2ea6a710f1f6?t=1773644778533).

## Run the safe checks now

From the repository root, after `npm ci`, using Python 3.10+:

```sh
python3 scripts/sdi-preflight.py --json
python3 -B -m unittest discover -s tests/integration -p 'test_sdi_preflight.py' -v
```

The baseline uses Python's standard library for hashes and WSDL inspection. **Actual XSD compilation/validation additionally requires `lxml`.** Use your approved Python environment and `python3 -m pip install -r scripts/sdi-requirements.txt` to install the pinned validator during setup if absent; the checker never installs or downloads anything. Without it, XSD checks are explicitly `not_run`, not passes. Run structural checks on the included fictional fixtures:

```sh
python3 scripts/sdi-preflight.py --xml tests/integration/fixtures/draft-invoice-synthetic.xml --schema invoice
python3 scripts/sdi-preflight.py --xml tests/integration/fixtures/smts-input-valid.xml --schema smts-input
python3 scripts/sdi-preflight.py --require-sandbox-ready --json
```

The final command deliberately exits **2** while the reviewed release lacks integration readiness. Other exit codes: **0** means the requested offline checks passed; **1** means an offline check failed. `--xml` and `--schema` must be supplied together. The available profiles distinguish an invoice, SMTS inner input and SMTS outer envelope. Validate the inner XML separately before embedding it: checking a wrapper does not validate the base64-decoded inner payload. An envelope's schema permits an optional XML signature; this tool does not verify a signature or waive the service's qualified-signature requirement.

No command above calls AWS, Fatture in Cloud or the Agenzia, reads credentials, signs a request or sends fiscal data. The optional validator rejects DTD/entity-bearing input, limits payload size, disables network access and resolves schema dependencies only from checksum-verified local files. The static invoice is a frozen synthetic example. The integration suite also invokes `scripts/sdi-export-fixture.ts` through the already-installed local TypeScript runner, exercising the actual exporter for TD01, TD04 and mixed-rate/fractional-quantity cases. It confirms that an overlong denomination fails the official schema and quotes are refused. These cases are not proof that all possible exports or fiscal business rules are valid.

## Source versions and review limits

Reviewed on **12 November 2026**. Agenzia pages that returned 403 in the research browser were retrieved directly over HTTPS. Published versions were read from document contents/current listings, not inferred from old URL labels. This is a requirements review; no channel, signer, delegation or provider credential was supplied or exercised.

| Contract | Current source reviewed | Repository evidence |
| --- | --- | --- |
| Ordinary invoice XML | XSD **1.2.3**, format specification **1.4** on [FatturaPA format page](https://www.fatturapa.gov.it/it/norme-e-regole/documentazione-fattura-elettronica/formato-fatturapa/) | `docs/references/fatturapa/Schema_VFPR12_v1.2.3.xsd` and checksum manifest |
| B2B process/business rules | [Allegato A **1.9.1**, 31 March 2026](https://www.agenziaentrate.gov.it/portale/documents/d/guest/allegato-a-specifiche-tecniche-vers-1-9-1) | Reviewed requirements; no implemented business-rule validator |
| SdI channel rules | **1.8.4**, current listing valid from **15 May 2026**, and controls **2.0** | [Official SdI listing](https://www.fatturapa.gov.it/it/norme-e-regole/DocumentazioneSDI/); channel artifacts are not yet a complete vendored integration bundle |
| Invoice WS interfaces | Transmission/reception manuals **3.3**; separately versioned WSDL/XSD | Official listing above; must pin the chosen sender/receiver/notification contracts before adapter work |
| Accreditation | [SA guide **2.0**](https://www.fatturapa.gov.it/export/documenti/guide/Guida-SA_v2.0.pdf) and current portal process | Company/IT steps above |
| SMTS | Technical/format documents and inner input **1.5**, published **16 March 2026**; wrapper/types/WSDL **1.0** | `docs/references/sdicoop/sources.json`; response/archive-specific schemas still need pinning for result ingestion |
| XML signature dependency | W3C XML-signature core schema, original bytes and included license | `docs/references/fatturapa/xmldsig-core-schema.xsd`, manifest and license notice |
| Fatture in Cloud | Current [e-invoice guide](https://developers.fattureincloud.it/docs/guides/e-invoice-management/), [company scope](https://developers.fattureincloud.it/docs/basics/company-scoped-methods/), [notifications](https://developers.fattureincloud.it/docs/webhooks/notifications/) and [quotas](https://developers.fattureincloud.it/docs/basics/limits-and-quotas/) | Read-only company-list adapter; remaining operations are requirements |

The namespace ending `/fatture/v1.2`, the XSD revision `1.2.3`, the B2B specification `1.9.1`, the channel specification `1.8.4` and SMTS `1.5` are different version identifiers. Keep them distinct in test reports. Update the source pins, tests and this decision when the selected adapter and company evidence are available.
