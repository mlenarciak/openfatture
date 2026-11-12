# API service

Fastify + TypeScript, exposed as a local HTTP server or AWS Lambda handler. API records are tenant scoped, and all currency values are integer euro cents.

## Local development

From the repository root:

```bash
npm run dev -w @openfatture/api
```

The default local server binds `127.0.0.1:3001`. Local demo authentication is available only outside production/Lambda. Demo records are fictional and seed the JSON store until the first mutation persists it at `apps/api/.data/openfatture.json`. Set `DATA_FILE` to change the path. Run one local API process; the JSON store serializes writes within that process and uses atomic file replacement.

## HTTP contract

Successful list responses are arrays; successful item responses are objects. Failures use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. `X-Request-Id` accompanies responses. Shared TypeScript types and Zod schemas live in `@openfatture/domain`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Public health and deployment mode |
| GET | `/api/companies` | Companies authorized for the verified subject |
| GET | `/api/dashboard` | Six-month chart, metrics, activity, upcoming balances |
| GET / POST | `/api/clients` | List or create company clients |
| GET / POST | `/api/documents` | List or create drafts; list supports search/status/kind query filters |
| GET | `/api/documents/:id` | Company-scoped document |
| POST | `/api/documents/:id/issue` | Mark a local draft ready; **does not issue or transmit a fiscal invoice** |
| GET | `/api/documents/:id/xml` | Draft XML attachment, marked `X-OpenFatture-Draft: true` |
| GET / POST | `/api/payments` | List or record payment; rejects overpayment and future dates |
| GET / POST | `/api/bulk-jobs` | List or save SMTS request drafts awaiting provider setup |
| GET | `/api/integrations` | Honest integration capability status |
| GET | `/api/integrations/fatture-in-cloud/companies` | Optional admin-only read-through to FIC company listing |

`X-Company-Id` selects a company from the caller’s memberships. Omitting it selects the first membership in multi-tenant mode, or the pinned company in self-host mode. Headers alone never grant access. Viewer memberships cannot mutate data. Payment creation accepts an optional `Idempotency-Key` header (8–128 letters, digits, `_` or `-`). Replaying the same key and payload returns the original payment, while reusing it with different data returns HTTP 409. Clients should retain the key across network retries.

## Production configuration

- `NODE_ENV=production`, `AUTH_MODE=cognito`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, and `TABLE_NAME` are required. The backend verifies access tokens with Cognito JWKS independently of API Gateway.
- `MULTI_TENANT=true` is the default. Set `MULTI_TENANT=false` and `SELF_HOSTED_COMPANY_ID=<company-id>` for a pinned self-host deployment. Other companies are unavailable even when the subject holds their memberships. Normal membership proof is still mandatory.
- `CORS_ORIGINS` is a comma-separated allowlist of browser origins.
- DynamoDB uses `pk` / `sk` string keys. The company aggregate item is `TENANT#<id>` / `STATE`. Memberships are `USER#<Cognito sub>` / `MEMBERSHIP#<id>` with `role` of `admin`, `editor`, or `viewer`.
- Every aggregate mutation uses a conditional version write. Conflicts return HTTP 409, preventing lost concurrent updates.
- The MVP aggregate is capped at 350 KB before DynamoDB’s 400 KB item limit. This bounds the starter’s company data capacity. Move documents/payments to individual items and paginated queries before substantial use.
- Optional `FIC_ACCESS_TOKEN` stays server side and must be pinned with `FIC_TENANT_ID`. The read-only adapter does not refresh OAuth credentials, synchronize records, or send documents.
- `ARTIFACTS_BUCKET` and `OUTBOX_QUEUE_URL` may be provisioned by infrastructure but are reserved; the service does not claim to upload or send records through them.

Provision an empty production company and its first membership with a full company profile. Set `AWS_PROFILE`, `AWS_REGION`, and `TABLE_NAME` in the environment:

```json
{
  "id": "company_example",
  "name": "Your Company S.r.l.",
  "vatNumber": "YOUR_11_DIGIT_VAT_NUMBER",
  "taxCode": "YOUR_TAX_CODE",
  "email": "amministrazione@example.com",
  "recipientCode": "0000000",
  "currency": "EUR",
  "taxRegime": "RF01",
  "address": {
    "street": "Your registered street and number",
    "city": "Milano",
    "postalCode": "20121",
    "province": "MI",
    "country": "IT"
  }
}
```

Replace the placeholders with real, verified company information. The seed command validates the format, not the fiscal truth or VAT checksum. The company ID accepts letters, digits, `_` and `-`, up to 80 characters.

```bash
npm run provision -- --company-file ./company.json --subject COGNITO_USER_SUB
```

Provisioning uses a DynamoDB transaction with existence guards; it cannot overwrite an existing tenant. Grant or revoke additional memberships with the separate administrator CLI. It first checks that the target company exists, then atomically changes only the membership. Grant requires an explicit role and refuses to overwrite an existing membership; revoke refuses a missing membership. To change a role, revoke and then grant deliberately.

```bash
npm run membership -w @openfatture/api -- --action grant --company-id company_example --subject ANOTHER_COGNITO_SUB --role editor
npm run membership -w @openfatture/api -- --action revoke --company-id company_example --subject ANOTHER_COGNITO_SUB
```

Use an AWS IAM role authorized to manage these records and record changes in your operational audit. The CLI can revoke the last application administrator; an authorized AWS operator can restore access by granting membership again. No company records are deleted or overwritten by membership administration. Cognito user provisioning and the service’s tenant membership provisioning are separate steps.

## Functional boundaries

The API is a working application foundation, not a certified accounting system. Draft invoice XML has not been validated against official invoice XSD, signed, sent to SdI, or conserved. Supported VAT rates are ordinary taxable 4%, 5%, 10%, and 22%; VAT exemptions, withholding, pension contributions, split payment, and other fiscal cases require extensions. Rounding is per net line, then per VAT rate group. Quotes do not affect revenue; credit notes reduce reported net revenue. Ready invoice balances can be paid locally; local readiness does not establish fiscal delivery.

SMTS requests are saved locally as `awaiting_configuration`. The app’s 90-day request window is a conservative local constraint, not a restatement of the official calendar-month rules. No provider request IDs, archives, receipt states, digital signature, certificates, delegations, legal conservation, or taxpayer portal actions are fabricated.
