# Before testing the SdI integration

**Decision on 12 November 2026: GO for offline checks; NO-GO for outgoing invoice submission, SMTS remote operations, Fatture in Cloud sending or fiscal production traffic.** A separate **incoming TEST receiver is implemented and deployed** in the reviewed operator environment. Register/review its test EPRs through the authorized accreditation operator, review the revocation gap, then coordinate the prescribed incoming SdI test. Interoperability is **not performed**; deployment is not channel accreditation, taxpayer authorization or fiscal correctness.

This guide tells the company administrator what to prepare and gives developers a test plan. Nobody needs to share SPID credentials, private keys, signing PINs or provider tokens in a support conversation. Keep those in the operator's approved credential system. Portal steps are based on current public documentation; private portal screens and this company's accreditation were not inspected.

## Choose the integration you intend to test

| Route | What happens | What OpenFatture currently implements |
| --- | --- | --- |
| Direct SdICoop invoice transmission | Your accredited channel sends invoice files to SdI and receives asynchronous notifications | Draft XML export plus a deployed incoming TEST notification gateway; no outgoing SOAP sender or end-to-end business reconciliation |
| Direct SdICoop invoice reception | SdI calls your accredited receiving endpoint with invoice files and metadata | Incoming TEST SOAP/MTOM gateway deployed with mTLS TEST-CA verification and exact peer pinning; authenticated SdI delivery and interoperability not yet evidenced; no business import pipeline |
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

The deployed `/api/*` routes require a Cognito token and accept business JSON; they are not these SOAP endpoints. The separate incoming TEST gateway uses its own mTLS TEST-CA verification, exact approved peer pin, bounded SOAP/MTOM parsing and fixed server-owned storage context. Do not disable authentication across the business API to make callbacks reachable, and do not trust an inbound `X-Company-Id` header to route fiscal data. The gateway quarantines test artifacts; it does not assign fiscal invoices to an application company.

## Certificate and test endpoint preparation update

**Operator update, 12 November 2026:** channel client/server certificates have been supplied, and local certificate/key matches, validity, extended TLS purposes, CA self-signatures and certificate chains have been checked. Operator identities chain to the supplied production CA, while the incoming SdI TEST peer must validate exclusively against the supplied TEST CA. The server identity is now installed on the dedicated incoming TEST service; the verified outgoing client identity is not in use because an outgoing sender has not been implemented. Installation, revocation and interoperability remain separate checks.

| Gate | Evidence and current status |
| --- | --- |
| Certificate inventory and key match | Certificates received; local key matches, validity and required TLS purposes checked. Certificate common names, validity dates and protected installation references belong in the operator's restricted inventory. No certificate or private-key material is published in this guide or repository. |
| Certificate installation | Server identity installed for the deployed incoming TEST service; its TLS chain and hostname were verified. The outgoing client identity is verified but not loaded into an active sender. The browser site's certificate and channel identity serve different endpoints and purposes. |
| Approved peer trust | Offline chain, identity and TLS-client purpose checks passed. The deployed listener trusts only the incoming TEST CA and the gateway requires the exact approved peer pin. Anonymous connections and the operator's own client certificate were rejected. No actual authenticated SdI handshake has been demonstrated. **No CRL is installed**; review and implement the approved revocation policy before relying on connected-test evidence. |
| Test callback endpoints | Incoming TEST gateway deployment completed on **12 November 2026 at 17:17:51 UTC**, with one healthy service task. Receiving and notification EPRs at `/test/RicezioneFatture` and `/test/TrasmissioneFatture` are published. Obtain the full configured HTTPS origin from the restricted operator-readiness view and confirm those exact EPRs with the accreditation operator. |
| Interoperability | **Not performed.** There is no actual authenticated SdI handshake, acknowledgement or stored SdI delivery yet. A separate synthetic diagnostic confirmed that the deployed task role can perform an encrypted conditional write and reject its duplicate; it did not exercise the SOAP receiver. Offline gateway tests cover storage-before-acknowledgement, but they do not prove those results in the deployed channel. A healthy task or TLS rejection is not an interoperability pass. |
| Production | Disabled and not activated. The corresponding `/prod/RicezioneFatture` and `/prod/TrasmissioneFatture` names are not permission to receive or send production traffic. Production activation remains a separate recorded decision. |

**Incoming TEST peer renewal:** the reviewed kit's incoming SdI TEST peer certificate expires on **5 December 2026 at 10:24:02 UTC**, approximately 23 days after this review. This is a different certificate from the operator's client/server identities and from the remote SdI server certificate. Obtain the updated incoming TEST peer from the official accreditation material before that deadline, verify its TEST chain, identity, purpose and fingerprint, then update the authorized pin and the approved CRL/revocation configuration. Do not bypass TLS or certificate checks to keep an expired test peer working. This deadline does not establish any production activation status.

**Next operator steps:** confirm the published HTTPS origin and these two EPRs in the restricted readiness view, record/register them in the authorized accreditation workflow, and review the missing CRL/revocation controls. Coordinate the actual incoming TEST case with the Agenzia. Capture the authenticated peer, acknowledgement and durable test-inbox evidence before recording the case outcome. Keep receiving invoices (`RicezioneFatture`) distinct from receiving transmission notifications (`TrasmissioneFatture`). No local probe using the operator's own client identity can impersonate the incoming SdI TEST peer. No outgoing sender or production channel has been enabled.

The application's operator-readiness view is intended only for an administrator of the tenant assigned to that channel. Other tenants and the public demonstration must not receive the operator certificate identities, issued-certificate validity dates or private storage references. The shared SdI TEST-peer renewal deadline above is public operational guidance. The public demo remains simulated and browser-local. This guide deliberately describes the workflow without publishing the operator's certificate common names or certificate files.

## Implementation blockers to close

These findings come from the current [API](https://github.com/mlenarciak/openfatture/blob/main/apps/api/src/app.ts), [XML exporter](https://github.com/mlenarciak/openfatture/blob/main/apps/api/src/xml.ts), [domain contracts](https://github.com/mlenarciak/openfatture/blob/main/packages/domain/src/index.ts) and infrastructure. They are implementation findings, not statements that the Agenzia has rejected a test.

- [ ] **Define and implement the selected adapter.** An isolated incoming TEST gateway is implemented and deployed. It safely parses the pinned SOAP/MTOM transport, enforces the configured peer boundary and quarantines test artifacts. There is no invoice SOAP sender, complete notification-to-business-state processor, SMTS worker or FIC document connector. The business API's outbox foundations remain unused for fiscal sending; the gateway has a separate private TEST inbox.
- [ ] **Freeze the fiscal document.** Keep immutable seller/buyer data, numbering/series, document version, approved XML bytes, hash, transmission filename and unique sending progressive. The current export downloads `DRAFT-<id>.xml`; that filename is intentionally not a transmission contract. Current draft numbering and `/issue` do not establish legal issuance.
- [ ] **Enforce fiscal validation before enqueueing.** The exporter supports ordinary domestic `FPR12`, `TD01` and `TD04`; quotes correctly fail export. Current field limits are application limits, not all XSD limits: for example, business names allow 160 characters while the invoice schema's denomination is shorter. Address limits, XML control characters, taxpayer validity, routing, dates and totals need validation against the selected profile and business rules.
- [ ] **Model supported tax cases explicitly.** Only positive taxable VAT rates 4/5/10/22 are modeled. No zero-rate/Natura, reverse charge, withholding, pension funds, split payment, foreign counterparties, PA-specific fields or simplified invoices are implemented. Do not silently approximate these cases. Ordinary private-invoice signing rules differ from PA and SMTS: qualified signing of every SMTS request is not a reason to assume every B2B invoice must be signed. [B2B rules v1.9.1](https://www.agenziaentrate.gov.it/portale/documents/d/guest/allegato-a-specifiche-tecniche-vers-1-9-1).
- [ ] **Separate business, transport and payment states.** `/issue` changes `draft` to local `ready`. `paid` is a local payment result. Neither proves SdI acceptance or delivery. Add transmission attempt/unknown result, accepted-by-transport, rejected, delivered, unavailable-for-delivery and applicable PA events separately; preserve raw receipts and their provenance.
- [ ] **Make submission recovery safe.** Atomically persist the immutable snapshot and outbox intent; assign tenant-scoped idempotency and correlation identifiers; reconcile an ambiguous timeout before retrying a send. Payment idempotency and aggregate optimistic concurrency already exist. The incoming TEST gateway also deduplicates deliveries with semantic/wire hashes and conditional object writes, but outgoing submission recovery and business reconciliation remain unimplemented. Current company aggregates have a 350 KB ceiling and are unsuitable for bulk invoice/archive storage.
- [ ] **Bind legal authority to each operation.** Map local company, taxpayer VAT/CF, provider/channel, receiving code and signer/delegation evidence. Scope all jobs, archive IDs, webhook subscriptions and receipt lookups to that mapping. Test expired/revoked/mismatched authorization and quarantine unresolvable inbound documents.
- [ ] **Complete trusted ingestion and business reconciliation.** The incoming TEST gateway implements peer restrictions, bounded transport parsing, duplicate handling and quarantined storage; it does not perform fiscal validation or update company invoice states. Complete the controlled processing, taxpayer mapping and late/out-of-order receipt reconciliation. Other provider routes still need their own verified notification token and parsing boundary. FIC uses its own signed notification token, not a Cognito access token; subscription verification, expiry and re-fetch of authoritative resource state also require implementation. [FIC notifications](https://developers.fattureincloud.it/docs/webhooks/notifications/).
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
| 1 · incoming gateway fixtures | Exact pinned SOAP/MTOM operations, 5 MiB files, bounded payloads, unsafe XML rejection, durable writes before ACK and idempotent retry | `apps/sdi-gateway/test/gateway.test.ts` and `adapters.test.ts`; synthetic offline fixtures, not an authenticated AWS delivery |
| 1 · outbound/provider adapter | Provider JSON or outgoing SOAP, correlation, 401/403, throttling, ambiguous timeout and late/out-of-order responses | Outgoing/provider adapter and recovery fixtures **missing** |
| 1 · recovery/isolation | Crash after intent/before send/after remote acceptance; replay and taxpayer isolation | Incoming TEST partial-write/retry and server-owned context covered offline; outgoing fiscal outbox and company reconciliation tests **missing** |
| 2 · incoming TEST deployment | Publish the isolated receiver; verify server TLS and reject unauthorized callers | Deployed at 17:17:51 UTC; one healthy task; server chain/hostname verified; anonymous and own-client connections rejected; TEST CA plus exact pin configured; **no CRL installed** |
| 2 · incoming TEST interoperability | Register/review exact EPRs, review revocation controls, then perform the prescribed authenticated incoming SdI cases | **Next scoped step, not a pass:** portal registration and real SdI TEST handshake/ACK/stored delivery evidence pending; interoperability `not_performed`; no outgoing sender |
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

The final command deliberately exits **2** for the broader sender/SMTS integration-readiness gate. The offline checker does not inspect or attest to the deployed incoming TEST receiver, its portal registration or a real SdI delivery. Other exit codes: **0** means the requested offline checks passed; **1** means an offline check failed. `--xml` and `--schema` must be supplied together. The available profiles distinguish an invoice, SMTS inner input and SMTS outer envelope. Validate the inner XML separately before embedding it: checking a wrapper does not validate the base64-decoded inner payload. An envelope's schema permits an optional XML signature; this tool does not verify a signature or waive the service's qualified-signature requirement.

No command above calls AWS, Fatture in Cloud or the Agenzia, reads credentials, signs a request or sends fiscal data. The optional validator rejects DTD/entity-bearing input, limits payload size, disables network access and resolves schema dependencies only from checksum-verified local files. The static invoice is a frozen synthetic example. The integration suite also invokes `scripts/sdi-export-fixture.ts` through the already-installed local TypeScript runner, exercising the actual exporter for TD01, TD04 and mixed-rate/fractional-quantity cases. It confirms that an overlong denomination fails the official schema and quotes are refused. These cases are not proof that all possible exports or fiscal business rules are valid.

## Reproduce the offline certificate checks

The read-only helper `scripts/sdi-verify-certificates.ts` requires the installed TypeScript runner, Node.js and **OpenSSL 3 or newer**. It reads only the explicitly named certificates and local private keys. It supports single certificates in PEM, DER or raw base64 and unencrypted PEM/DER private keys. It never imports into AWS or a trust store, makes network calls, requests passwords, prints keys or changes the supplied files. Only normalized **public** certificates are written to a private temporary directory, which is removed after verification.

An authorized operator can supply the protected local paths and the independently confirmed expected taxpayer, hostname and incoming TEST peer pin:

```sh
node --import tsx scripts/sdi-verify-certificates.ts --help
node --import tsx scripts/sdi-verify-certificates.ts \
  --client /secure/channel/client.cer --client-key /secure/channel/client.key \
  --server /secure/channel/server.cer --server-key /secure/channel/server.key \
  --production-ca /secure/channel/production-ca.pem \
  --test-ca /secure/channel/test-ca.pem --test-peer /secure/channel/incoming-test-peer.cer \
  --tax-code "$OPENFATTURE_TAX_CODE" --hostname "$OPENFATTURE_CHANNEL_HOSTNAME" \
  --test-peer-sha256 "$OPENFATTURE_TEST_PEER_SHA256"
```

The additional optional `--test-peer-cn` selects an independently approved incoming identity; by default the helper expects `Sistema Interscambio Fattura PA` and the TEST anchor common name `CA Agenzia delle Entrate Test`. Operator client/server chains use the supplied production CA even for interoperability; the incoming TEST peer uses **only** the supplied TEST CA with TLS-client purpose. A production-issued peer with the same common name must fail this test check. Server hostname validation checks DNS SAN first and explicitly permits common-name fallback only when no DNS SAN is present. The client common name must exactly equal `SDI-` followed by the supplied tax code. Private-key matches, distinct client/server SPKI key pairs, explicit EKU, certificate validity, CA status, self-signatures, purpose and selected chains are checked independently. Obtain the roots through the approved official process: checking a supplied self-signed root does not independently establish its portal provenance or public browser/web CA trust.

The JSON report contains public certificate metadata and named pass/fail checks, without private keys, PEM bodies, source paths or raw OpenSSL errors. Keep the report in the restricted operator record because public certificate metadata can still identify the channel operator. The optional pin is compared when supplied; otherwise the computed TEST peer fingerprint is merely recorded, not independently confirmed. Exit **0** means all requested offline checks passed; **1** means verification failed; **2** means the CLI arguments were invalid. Revocation, CRL freshness, endpoint reachability and interoperability are explicitly **not checked**.

The helper does not scan an entire kit directory. An unrelated expired production remote-server certificate is not an input to this incoming TEST peer check and does not justify weakening the test trust policy. Conversely, this helper does not validate that remote production server for a later outbound connection. The maintenance tests in `apps/api/test/sdi-certificates.test.ts` generate only temporary synthetic CA/leaf certificates and keys; no supplied operator certificates or keys are committed as fixtures.

## Source versions and review limits

Reviewed on **12 November 2026**. Agenzia pages that returned 403 in the research browser were retrieved directly over HTTPS. Published versions were read from document contents/current listings, not inferred from old URL labels. The requirements review was followed by receipt and local key matching of operator channel certificates. Offline chain, purpose and distinct-key checks have passed. The incoming TEST gateway is deployed with negative caller tests; actual authenticated SdI delivery, CRL configuration and prescribed interoperability remain pending as recorded above. No qualified signer, taxpayer delegation or provider sending credential has been exercised.

| Contract | Current source reviewed | Repository evidence |
| --- | --- | --- |
| Ordinary invoice XML | XSD **1.2.3**, format specification **1.4** on [FatturaPA format page](https://www.fatturapa.gov.it/it/norme-e-regole/documentazione-fattura-elettronica/formato-fatturapa/) | `docs/references/fatturapa/Schema_VFPR12_v1.2.3.xsd` and checksum manifest |
| B2B process/business rules | [Allegato A **1.9.1**, 31 March 2026](https://www.agenziaentrate.gov.it/portale/documents/d/guest/allegato-a-specifiche-tecniche-vers-1-9-1) | Reviewed requirements; no implemented business-rule validator |
| SdI channel rules | **1.8.4**, current listing valid from **15 May 2026**, and controls **2.0** | [Official SdI listing](https://www.fatturapa.gov.it/it/norme-e-regole/DocumentazioneSDI/); channel artifacts are not yet a complete vendored integration bundle |
| Invoice WS interfaces | Transmission/reception manuals **3.3**; separately versioned WSDL/XSD | Receiver/notification WSDL and XSD bytes pinned in `apps/sdi-gateway/references/sources.json`; outgoing sender still unimplemented |
| Accreditation | [SA guide **2.0**](https://www.fatturapa.gov.it/export/documenti/guide/Guida-SA_v2.0.pdf) and current portal process | Company/IT steps above |
| SMTS | Technical/format documents and inner input **1.5**, published **16 March 2026**; wrapper/types/WSDL **1.0** | `docs/references/sdicoop/sources.json`; response/archive-specific schemas still need pinning for result ingestion |
| XML signature dependency | W3C XML-signature core schema, original bytes and included license | `docs/references/fatturapa/xmldsig-core-schema.xsd`, manifest and license notice |
| Fatture in Cloud | Current [e-invoice guide](https://developers.fattureincloud.it/docs/guides/e-invoice-management/), [company scope](https://developers.fattureincloud.it/docs/basics/company-scoped-methods/), [notifications](https://developers.fattureincloud.it/docs/webhooks/notifications/) and [quotas](https://developers.fattureincloud.it/docs/basics/limits-and-quotas/) | Read-only company-list adapter; remaining operations are requirements |

The namespace ending `/fatture/v1.2`, the XSD revision `1.2.3`, the B2B specification `1.9.1`, the channel specification `1.8.4` and SMTS `1.5` are different version identifiers. Keep them distinct in test reports. Update the source pins, tests and this decision when the selected adapter and company evidence are available.
