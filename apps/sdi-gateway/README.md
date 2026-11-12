# SdI TEST receiving gateway

This service receives **test callbacks only**. It does not send invoices, call Agenzia services, activate a channel, assign a codice destinatario, or process production fiscal traffic.

It implements the provider-facing SOAP 1.1 operations from the official RicezioneFatture v1.0 and TrasmissioneFatture v1.1 WSDLs referenced by the SdICoop 3.3 manuals. Exact downloaded files, official URLs, retrieval date and SHA-256 hashes are in [references/sources.json](references/sources.json). Source files remain unchanged; tests verify their hashes.

## Endpoints and acknowledgement

| POST endpoint | WSDL operation | Body element | Success |
| --- | --- | --- | --- |
| `/test/RicezioneFatture` | `RiceviFatture` | `fileSdIConMetadati` in reception types namespace | SOAP `rispostaRiceviFatture`, unqualified `Esito=ER01` |
| `/test/RicezioneFatture` | `NotificaDecorrenzaTermini` | `fileSdI` in reception types namespace | HTTP 202, empty body (one-way) |
| `/test/TrasmissioneFatture` | `RicevutaConsegna` | `ricevutaConsegna` | HTTP 202, empty body |
| `/test/TrasmissioneFatture` | `NotificaMancataConsegna` | `notificaMancataConsegna` | HTTP 202, empty body |
| `/test/TrasmissioneFatture` | `NotificaScarto` | `notificaScarto` | HTTP 202, empty body |
| `/test/TrasmissioneFatture` | `NotificaEsito` | `notificaEsito` | HTTP 202, empty body |
| `/test/TrasmissioneFatture` | `NotificaDecorrenzaTermini` | `notificaDecorrenzaTermini` | HTTP 202, empty body |
| `/test/TrasmissioneFatture` | `AttestazioneTrasmissioneFattura` | `attestazioneTrasmissioneFattura` | HTTP 202, empty body |

All transmission elements use the transmission types namespace. Each operation requires its exact official SOAPAction. Reception's invoice action ends in `RiceviFattureSdI`; it is not constructed from the operation name. Child fields are unqualified, as the pinned XSDs require. Exact field order, cardinality, scalar constraints, namespaces and actions are validated in the transport contract.

`ER01` means the valid test delivery has been **durably taken into custody**. It is returned only after raw wire bytes, decoded attachment bytes, and a final completion manifest have been stored successfully. It does not attest to invoice fiscal validity, signature validity, legal conservation, or processing by the application.

Production URLs always fail closed. Unknown paths and methods do not receive a successful acknowledgement. `GET /health` returns only process health: `{ "status": "ok", "mode": "test-only" }`. This is not an accreditation or interoperability readiness assertion.

## Deployment

The full-size deployment uses an ALB HTTPS listener in **mTLS VERIFY** mode and a dedicated Fargate task. The task security group must allow port 8080 **only from the ALB security group**, and the task has no public application ingress. The ALB terminates TLS and injects its verified client leaf certificate. The application accepts that header only when `SDI_PROXY_MODE=alb`, rejects duplicate or concatenated certificates, checks the leaf's exact SHA-256 pin, and independently checks its validity dates.

A direct public HTTP deployment with `SDI_PROXY_MODE=alb` would let callers forge the header. Never use this mode outside the restricted ALB VERIFY architecture. Pinning is an additional check; it does not replace the listener's trust-chain verification. Our own server/client certificates do not authenticate an incoming SdI peer. Use the SdI TEST peer identity obtained and verified through the accreditation kit; keep its expiry and rotation under review.

| Variable | Purpose |
| --- | --- |
| `SDI_PROVIDER_CONTEXT` | Fixed server-side provider/channel slug, 1–80 letters, digits, `_` or `-` |
| `SDI_TEST_PEER_SHA256` | Comma-separated approved SdI TEST leaf fingerprints, 64 hex characters each; empty list blocks all deliveries |
| `SDI_ARTIFACTS_BUCKET` | Dedicated private TEST inbox S3 bucket |
| `SDI_KMS_KEY_ID` | Required customer-managed KMS key for every object write |
| `SDI_PROXY_MODE` | `alb` for the restricted ALB VERIFY deployment; other values cannot authenticate forwarded certificates |
| `SDI_MAX_CONCURRENT` | Bounded simultaneous deliveries; default 4, allowed 1–16; size memory for the chosen value |
| `PORT` | Internal HTTP port, default 8080 |

Build the container from the monorepo root with `apps/sdi-gateway/Dockerfile`. Both build and runtime use an immutable digest of the official Node 24 image. Runtime uses the unprivileged `node` user, a bundled application, and no filesystem writes; a read-only root filesystem is supported. No certificates, keys, credentials, document data, or unrelated application source are copied into the runtime image.

The optional Lambda adapter uses only API Gateway's `requestContext.authentication.clientCert`, never forwarded certificate headers. Buffered Lambda invocation events are limited to 6 MB, so this adapter is unsuitable for the full SdI payload range. The ALB/Fargate server is the full-size target.

## Safe parsing and storage

- SOAP 1.1 `text/xml` and MTOM `multipart/related` are supported. MTOM root and content IDs are checked, binary bytes are preserved, and XOP references can point only to included MIME parts. Remote references, duplicate IDs, missing or unused attachments, malformed framing, and excessive parts are rejected.
- The receiver supports up to 5 MiB for the invoice/archive/notification file, 1 MiB for metadata, and 12 MiB for the complete wire body. These are explicit bounded receiver limits; invoice/archive bytes are never decompressed or executed. HTTP content encoding is restricted to identity.
- SOAP must be UTF-8. DTDs, entity declarations, external entities, unknown entities, extra operations, wrong namespaces, unknown SOAP headers, invalid base64, and excessive structure are rejected. Primitive constraints and sequences are checked against the pinned transport schemas; this is not a general fiscal XSD validation engine.
- Attachments remain opaque, quarantined bytes. Invoice XML/P7M/ZIP semantics, signatures and fiscal XSD validation must be performed by a separate controlled processor. The gateway never extracts an archive or parses a stored invoice as executable content.
- Artifact keys use `test/<server-provider-context>/<service>/<operation>/<semantic-digest>/...`. Caller company headers, body identifiers and filenames never select a tenant or storage namespace. Filenames are metadata, not path components.
- Every S3 write uses `If-None-Match: *`, a content checksum and SSE-KMS. The raw request key includes the wire digest; decoded attachment keys include their content digests. Retries with a different MIME boundary preserve an additional raw representation and reuse the same semantic completion marker.
- The manifest is written last. An incomplete storage operation returns a SOAP server fault, never `ER01` or one-way success. Retries can complete a partial upload. The S3 role needs only `PutObject` under this server-owned test prefix and the required narrowly scoped KMS permissions; no production bucket access or object reads are needed.

The stored completion manifest explicitly records `fiscalValidation: not-performed` and `applicationProcessing: quarantined`. No automatic production tenant assignment or invoice status change is performed.

## Verification

```bash
npm run typecheck -w @openfatture/sdi-gateway
npm run test -w @openfatture/sdi-gateway
npm run build -w @openfatture/sdi-gateway
```

Tests use invented XML and an explicitly synthetic public peer certificate whose private key was discarded. They cover all eight operations, official source hashes, full-size inline/MTOM deliveries, binary integrity, duplicate retries, partial failures, namespace/entity/XML attacks, payload limits, pinned peer dates, restricted ALB and API Gateway identity paths, and SSE-KMS conditional writes. These offline checks do not constitute SdI interoperability testing or successful accreditation.
