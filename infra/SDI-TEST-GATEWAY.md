# SdI TEST gateway operations

This optional stack receives **test traffic only**. It does not transmit invoices, assign a recipient code, activate a production channel, process quarantined receipts into a company ledger, or provide digital preservation. `sdiGateway` defaults to `false`; a new normal application creates no always-on receiver. Turning the flag off later omits the gateway from future synthesis; CDK does not delete an already deployed stack, so its costs continue until deliberate cleanup. The operator metadata shown by the application is a separate configuration and must describe the actual deployment state.

## Deployment record — 12 November 2026

`Openfatture-prod-SdiTest` reached `CREATE_COMPLETE` at **17:17:51 UTC**. One Fargate task is running, its rollout completed, and its ALB target on port 8080 is healthy. Both TEST EPRs below are published. Live inspection confirmed HTTPS 443 with mTLS VERIFY, the active TEST trust store, expired-client rejection, the exact two POST routes, the 403 production/default rule, ALB-only task ingress and no NAT gateway.

The server certificate chain and `sdi.openfatture.com` hostname validate against the reviewed issuing CA. Anonymous TLS and the issued OpenFatture client certificate are rejected before an HTTP response. The deployed container digest is `sha256:67cb36a76d4f0a57a33b416cee6323d90648a34af443dcea777f66223f274c28`; it matches the reviewed frozen assembly's content-tagged ECR image. No invoice or receipt artifacts were created by these checks. No authorized live SdI peer handshake, ACK, fiscal send or receipt-storage write has been performed; interoperability remains **not performed**.

One isolated ECS diagnostic task subsequently used that same reviewed image and task role to put a **120-byte synthetic marker** under `test/dlt-viaggi/diagnostics/storage-f28d48ca-190d-4968-8d12-8a20dbb6d3ae.json`. The SSE-KMS conditional PUT returned 200; repeating the identical conditional PUT returned 412 `PreconditionFailed`. Read-only metadata inspection confirmed the exact inbox KMS key and SHA256 `b6e02b1d5febf75ac26bff4d96662f5e1ddd8a83e11d5b149cc932417f693bd8`. The diagnostic task stopped with exit code 0. This verifies actual S3/KMS access and conditional-write behavior; it is **not a SOAP exchange or SdI ACK** and did not change the running receiver, trust or peer pin.

During review, IAM principal simulation returned an inherited region-SCP denial. Read-only Organizations inspection established that this deployment account is the management account; [SCPs do not restrict its roles](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html). The actual same-role diagnostic write succeeded. No organization, IAM or bucket policies were broadened to resolve the simulator result.

The reviewed deployment uses regional server certificate `arn:aws:acm:eu-south-1:509581811464:certificate/3c4ef5e2-2edb-4755-94a4-a361c57a5055`, CA bucket `openfatture-prod-data-artifacts82dd59a1-sfgvyr7v8iwc`, key `sdi/test/trust/CAEntratetest.pem`, version `.DYupDvuWmH9ptSjll9RAK04mUqUq7GG`, and provider context `dlt-viaggi`. The inbox is `openfatture-prod-sditest-inboxa8e05dc3-ibbvxzjmzzqn`. These are resource identifiers and public trust metadata; private certificate keys are not in the repository or container.

## Trust and certificate prerequisites

Use the official SdI test kit supplied by the channel operator. The verified kit received on 12 November 2026 contains separate trust material for the incoming SdI TEST caller and the issued OpenFatture certificates:

| Purpose | Required material |
| --- | --- |
| Server identity on `sdi.openfatture.com` | Issued server certificate, its matching private key, and the `caentrate.pem` issuer chain, imported into ACM in **eu-south-1**. The private key stays outside Git, build contexts, environment variables and the container. |
| Authenticate incoming TEST calls | A PEM trust bundle containing **only `CAEntratetest.pem`**, from the verified kit, in an existing private versioned S3 bucket. Pin its exact object version. |
| Authorize the incoming peer | Exact SHA256 of the kit's **SdI TEST client leaf certificate**, checked against the TEST CA and current validity. This is different from the issued OpenFatture client certificate. |
| Future outgoing calls | The issued OpenFatture client certificate and its matching separate key. The receiver does not load or use this key. |

The verified SdI TEST client leaf fingerprint is `61d7b06c3abbac6ebe6163461705208ea1478581cb66e09a11a1a6c4220a0bbb`. It expires **5 December 2026 at 10:24:02 UTC**. Obtain the replacement through the official channel and review both chain and fingerprint before rotation; the application rejects an expired certificate. Do not broaden the trust bundle to production roots or pin the OpenFatture client certificate to bypass a failed test.

The kit did not supply a usable reviewed CRL. No revocation list is installed: ALB checks the configured CA chain and certificate validity, and the receiver checks the exact peer fingerprint and validity. This is not a claim of revocation checking. A future CRL must come from the verified issuer and be reviewed, version-pinned and deliberately added to the trust store.

For the CA bundle, preserve PEM certificate contents, remove blank lines, and include no keys or leaf certificates. The existing retained application artifacts bucket can hold this **public CA material** under `sdi/test/trust/CAEntratetest.pem` with explicit per-object `AES256` encryption. This does not change the bucket's default KMS encryption or any invoice object's encryption. Capture the S3 `VersionId` and a local SHA256 when uploading; do not use `null` or rely on the latest object version. Existing bucket policies and deployment permissions must allow the reviewed trust-store import without public access. Do not put CA artifacts in a disposable build-assets lifecycle.

ACM does not renew an imported private-CA certificate automatically. Track the server/client certificate expiry and repeat the verified import procedure before expiry. This listener uses the SdI-issued server certificate; a normal browser may report its private issuer as untrusted. The website's public ACM certificate and CloudFront configuration remain separate.

## Architecture and limits

`Openfatture-prod-SdiTest` creates a dedicated two-AZ VPC, public ALB, one Fargate task (0.25 vCPU / 512 MiB), private KMS-encrypted versioned inbox, logs, and the `sdi.openfatture.com` A alias. It imports the existing Route 53 zone, ACM server certificate and versioned CA object; it does not alter the existing DLT network, company data stack or protected business API.

The only listener is HTTPS 443 with mTLS **VERIFY**, TLS 1.2/1.3 and expired-client-certificate rejection. Only POST requests to the exact two TEST paths reach the receiver. All other paths and methods receive 403. The target group's `/health` check is internal; it confirms a running test receiver, not fiscal readiness.

The task has a public IP for outbound HTTPS to S3, ECR and CloudWatch, avoiding a NAT gateway. Its security group permits port 8080 **only from the ALB security group**. Client certificate headers have meaning only behind this ALB boundary. The application authorizes the ALB-provided leaf certificate before buffering the SOAP body. Containers run as uid 1000 with a read-only root filesystem and no ECS Exec access.

The receiver accepts up to 12 MiB on the wire, a 5 MiB decoded invoice attachment and 1 MiB metadata, with four simultaneous requests by default. This accommodates the base64/MIME envelope without the Lambda synchronous event limit. API Gateway plus buffered Lambda was rejected because its 6 MB event limit also includes JSON/base64 overhead. Full-size handling is covered by the gateway tests; a successful real SdI exchange still requires interoperability testing.

The task can put objects only under `test/<providerContext>/*`, with the exact SSE-KMS key. KMS use is restricted to S3 and that object prefix. It cannot read the ledger, send fiscal traffic, read secrets or fetch inbox objects. Raw wire bodies, decoded attachments and a final manifest are durable before the ACK. Conditional creates and content digests make retries idempotent; a manifest marks a complete quarantined receipt. Retained versioned S3 is operational storage, **not compliant preservation or WORM retention**.

ALB access/connection logs retain 90 days in a separate private SSE-S3 bucket; application logs retain 30 days. ALB logs do not contain request bodies, but connection logs contain certificate metadata and client IP addresses; restrict operator access accordingly. No log publishing/alert channel is configured automatically.

CDK publishes the container under a content-derived tag in the existing bootstrap ECR repository, which was verified to use `IMMUTABLE` tags. ECS resolves the tag to a digest with version consistency enabled. The image build excludes local environment files, issued certificates, keys, Git metadata and infrastructure build output. Review the asset manifest before publishing; the runtime image contains only the bundled receiver and Node runtime.

## Synthesis, review and deployment

Supply the complete existing production context on every review/deployment, plus the gateway context below. Use real reviewed resource identifiers; the tests use deliberately fictional identifiers that must never be deployed.

```bash
OPENFATTURE_PROD_CONTEXT=(
  -c stage=prod -c publicDemo=true -c multiTenant=true
  -c domainName=openfatture.com
  -c hostedZoneId=Z0205029353SA9C8BO1GN
  -c certificateArn=arn:aws:acm:us-east-1:509581811464:certificate/1cd10045-fa13-4a9e-8cc9-18e8b0db43c4
)
OPENFATTURE_SDI_CONTEXT=(
  -c sdiGateway=true
  -c sdiServerCertificateArn="$OPENFATTURE_SDI_SERVER_CERT_ARN"
  -c sdiTruststoreBucketName="$OPENFATTURE_SDI_CA_BUCKET"
  -c sdiTruststoreKey=sdi/test/trust/CAEntratetest.pem
  -c sdiTruststoreVersion="$OPENFATTURE_SDI_CA_VERSION"
  -c sdiTestPeerSha256=61d7b06c3abbac6ebe6163461705208ea1478581cb66e09a11a1a6c4220a0bbb
  -c sdiProviderContext=dlt-viaggi
)
```

The optional application metadata requires both `-c sdiOperatorTenantId=dlt-viaggi` and `-c sdiReadinessFile=/absolute/private/path/operator-readiness.json`. The file must satisfy `sdiOperatorReadinessSchema` in `packages/domain/src/index.ts`, contain only public metadata, and be at most 16 KiB. It must never contain PEM, credentials or private key paths. Strict parsing rejects unknown fields and production enablement. Keep both contexts on future application deployments; omitting both removes the operator metadata. Stored company membership is still required to see that company's readiness; setting metadata does not provision a company or grant access.

```bash
npm run typecheck --workspace @openfatture/infra
npm run test --workspace @openfatture/infra
cd infra
AWS_PROFILE=dlt AWS_REGION=eu-south-1 npx cdk synth '*' --strict \
  "${OPENFATTURE_PROD_CONTEXT[@]}" "${OPENFATTURE_SDI_CONTEXT[@]}" \
  --output /tmp/openfatture-sdi-reviewed
AWS_PROFILE=dlt AWS_REGION=eu-south-1 npx cdk diff '*' \
  --app /tmp/openfatture-sdi-reviewed --no-change-set
```

Check the frozen assembly and diff: the new TEST stack is expected; existing data resources must remain unchanged. Readiness metadata changes belong only to the existing API Lambda environment. Verify CA object provenance/version, server certificate hostname/chain/private-key match, peer fingerprint/current expiry and the absence of private material in Docker assets. Synthesis does not validate the remote CA object's contents or actual ACM status.

Only after that review, deploy the same frozen assembly with the normal CloudFormation deployment path (`--hotswap` and `--express` are prohibited here). `cdk deploy '*' --app /tmp/openfatture-sdi-reviewed --outputs-file cdk-outputs.json` creates billable resources and publishes the reviewed container. No code in this guide registers the EPR in the SdI portal or activates a production channel.

The two outputs to enter in the **test** channel configuration, after deployment and negative TLS checks, are:

| Output | EPR |
| --- | --- |
| `SdiTestReceiveEpr` | `https://sdi.openfatture.com/test/RicezioneFatture` |
| `SdiTestNotificationEpr` | `https://sdi.openfatture.com/test/TrasmissioneFatture` |

Publication is established when the stack reaches `CREATE_COMPLETE`/`UPDATE_COMPLETE`, the receiver target is healthy, DNS resolves, and the server chain/hostname and negative client-authentication checks pass. At that point the endpoint can be marked `deployed` while interoperability remains `not_performed`: an authorized SdI TEST peer handshake and positive live ACK still require the portal test process. There is no public HTTP fallback, port 80 redirect, WSDL route or fiscal production route.

## Verification and rotation

1. Check CloudFormation and ECS stability, ALB target health, pinned CA version and deployed image digest. Confirm the task ENI security group has no CIDR-based ingress and the ALB's only public port is 443.
2. Confirm missing certificates and the issued OpenFatture client certificate fail the incoming TLS handshake. Validate the server chain/hostname using its separate issuing CA. The kit supplies the SdI TEST caller's **public certificate, not its private key**: a positive live mTLS exchange must be triggered by the actual SdI TEST environment through the portal/interoperability process. Do not request the SdI-owned private key, add the OpenFatture client to the incoming trust/pins for a probe, disable TLS verification, or substitute a production invoice. Local positive fixtures prove parser/storage behavior without claiming an authorized live SdI exchange.
3. Check valid TEST SOAP, wrong namespace/operation, malformed base64/MIME, full-size attachment, over-limit attachment, repeat delivery and S3 failure cases against [the integration matrix](../docs/sdi-integration-testing.md). A storage failure must never return a success ACK.
4. Inspect the isolated test prefix for complete manifests and attachment hashes. Quarantine is intentional: no tenant invoice status or payment should change. Production path probes must return 403 for an otherwise authenticated TLS peer.
5. Before **5 December 2026**, review the replacement SdI TEST client chain, validity and SHA256 through the official channel. Temporarily pin old and new exact leaf certificates only during an explicitly reviewed overlap. Keep the test CA bundle narrow; update its pinned version only if the reviewed CA changes. Remove the retired pin after the transition.
6. Repeat strict synth, diff, frozen-assembly deployment and negative/positive TLS checks for every certificate, trust-store or peer-pin change. Imported ACM certificates and the existing CA bucket remain operator-managed. Termination/deletion protection and retained inbox/key/logs require a deliberate cleanup plan to stop recurring receiver costs without losing test evidence.

## Cost estimate and sources

Reviewed on 12 November 2026. At 730 hours/month in Milan, ALB ($0.0265/hour), its associated mTLS trust store ($0.0059/hour), 0.25 vCPU ($0.0486/vCPU-hour), 0.5 GiB memory ($0.0053/GiB-hour) and approximately three public IPv4 addresses ($0.005/address-hour) total about **USD 45.41/month before LCU, KMS, storage, logs, request and transfer charges**. Allow roughly **USD 40–60/month for low-volume testing**; this is an estimate, not a cap. Extra tasks during rollout, ALB scaling, large traffic or longer retention add cost. There is no NAT gateway and no paid Inspector/Shield Advanced feature enabled by this stack.

Primary AWS references: [ALB mTLS and certificate headers](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/mutual-authentication.html), [versioned trust-store configuration and optional CRLs](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/configuring-mtls-with-elb.html), [Lambda synchronous payload limits](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), [Fargate task sizes and networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html), [S3 conditional PUT and KMS permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html), [CDK bootstrap image repository](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html), [Milan ECS price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/eu-south-1/index.json), [Milan ELB price list](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/eu-south-1/index.json), [public IPv4 pricing](https://aws.amazon.com/vpc/pricing/).
