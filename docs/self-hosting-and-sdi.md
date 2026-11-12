# Self-hosting and your own SdI recipient code

This guide is for the person responsible for an Italian company's invoicing. It separates the work you do in OpenFatture from the work you do on the Agenzia delle Entrate websites. Technical steps are marked **IT administrator**.

Reviewed against the official public pages on **12 November 2026**. The private portal screens were not accessed. Screen labels can change; use the official links below and the current instructions shown after login.

## Start here: choose your route

| What your company wants | What to do |
| --- | --- |
| Host its own invoicing workspace, while using an existing accredited provider | Deploy OpenFatture for one company. Obtain the provider's recipient code and register it in Fatture e Corrispettivi. Your company does not need its own accredited channel. |
| Operate its own direct SdI channel and receive invoices on its own code | Complete channel development, accreditation, interoperability tests and production activation. Then request the recipient code. |
| Offer a shared application to several companies | Enable multi-tenant mode. Each company needs its own membership, invoice data and provider authorization. The operator can use an accredited provider or complete its own accreditation. |

**Current release:** OpenFatture runs the workspace, drafts and payment records. A separate incoming SdI **TEST** receiver is implemented and deployed in the reviewed operator environment, with quarantined transport storage and production paths disabled. There is no outgoing invoice sender, live SMTS adapter, qualified request signing or compliant conservation. No actual authenticated SdI delivery or interoperability pass has been recorded. Deploying the app or entering a code does not activate a production channel. See the [integration testing status](sdi-integration-testing.md) and [implementation scope](product-research.md).

## Understand the three different identifiers

- **Partita IVA:** identifies the business for VAT purposes.
- **Codice destinatario B2B:** seven letters/numbers identifying an SdI receiving channel. Businesses often call this a “codice univoco.” A provider's code can be shared by many customers; the receiving system must route each invoice to the correct company.
- **Codice univoco ufficio:** the six-character code used for an office of a public administration, recorded in IndicePA. It is a different code.

A code is assigned by SdI. OpenFatture cannot generate one. A channel enabled only for sending cannot obtain a receiving code until receiving is accredited. The official [new accreditation process](https://www.fatturapa.gov.it/it/SistemaAccreditamento/processo-per-nuovo-accreditamento/) explains these distinctions.

## Route A: self-host with an existing provider

1. Ask your chosen accredited provider for its seven-character recipient code and its connection requirements. Confirm that it supports your intended API workflow. The included Fatture in Cloud adapter currently only reads the company list.
2. Ask the person authorized for your company to sign in to [Fatture e Corrispettivi](https://ivaservizi.agenziaentrate.gov.it/). Use the company's authorized access role and select the correct company or represented taxpayer.
3. Open the service named **Registrazione dell'indirizzo telematico dove ricevere tutte le fatture elettroniche**. It is associated with the invoicing area; the location can change.
4. Choose **Codice destinatario**, enter the code supplied by the provider, and confirm/save the registration. Check the success message and keep a record of the selection.
5. Read back the registered code. Share it with suppliers and update the company's invoicing details/QR code where appropriate. The registration sets a preferred delivery address; simply telling a supplier is a separate action.
6. Coordinate a real reception test with the provider after it is operational. Check both the received XML and its company/VAT details before considering the switch complete.

Registering an address does not create a new recipient code. The Agenzia's [invoicing guide](https://www1.agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica.html/guide-gallery.html) explains registration and the available delivery methods.

**What you should have at the end:** a recorded recipient address on the Agenzia portal, a provider agreement and a tested receiving service. OpenFatture must still have a completed provider connector before it can import or send live documents.

## Route B: obtain your own direct receiving code

### 1. Prepare the company and authorized operator

**Company administrator:** confirm that the company is registered for the Agenzia's Entratel/Fisconline services and that the person handling accreditation is authorized to act for it. The current guide permits SPID, CIE, CNS or the applicable Entratel/Fisconline credentials.

A **Gestore Incaricato** can authorize an additional operator through the Agenzia reserved area:

1. Open **Il tuo Profilo → Incarichi**.
2. Choose **Gestisci incarichi come gestore**.
3. Select the operator and choose **Gestisci Servizi**.
4. Enable **Accreditamento e gestione dei canali trasmissivi** and confirm.

Use the official [Sistema di Accreditamento guide, version 2.0](https://www.fatturapa.gov.it/export/documenti/guide/Guida-SA_v2.0.pdf), especially its access and operator-authorization sections. It also explains the separate process for foreign operators.

### 2. Prepare the receiving service

**IT administrator:** read the current [SdI technical documentation](https://www.fatturapa.gov.it/it/norme-e-regole/DocumentazioneSDI/). For the Web Service route, implement the current SdICoop reception interface, notification handling and certificate requirements. Arrange continuous monitoring, certificate renewal, backups and incident ownership.

The chosen channel must support **receiving**. Web Service channels can be accredited for sending, receiving or both. SFTP accreditation covers both directions. Self-hosting the business HTTP API is not sufficient: that API accepts business JSON, not SdICoop SOAP. The separate incoming TEST gateway implements receiving and notification transport and stores artifacts in quarantine. Its deployment must be configured explicitly and followed by portal registration, authenticated SdI tests and the remaining operational controls; it does not import fiscal invoices into the workspace or authorize production.

### 3. Open the current accreditation system

**Authorized operator:** go to [Sistema di Accreditamento](https://accreditamento.fatturapa.gov.it/), also linked from the [official introduction](https://www.fatturapa.gov.it/it/SistemaAccreditamento/).

Select the company for which you are acting. Start the new channel procedure and enter the company/subscriber details, the person responsible for the service agreement, technical contacts and channel details requested by the system.

For Web Service channels, follow the portal's CSR and certificate-generation steps. Your IT administrator creates the certificate signing request and protects the corresponding private key. Keep test and production material separate. Do not put private keys or signatures in Git, browser configuration or support messages.

### 4. Complete the tests and activate production

**IT administrator and authorized operator:** use the exact published TEST EPRs from the restricted operator-readiness view. The reviewed deployment has verified server TLS and rejection of anonymous/own-client connections, but no actual authenticated SdI handshake, acknowledgement or stored delivery yet. Review the missing CRL/revocation configuration, then run the interoperability cases requested by the portal, resolve failures, and review and accept the generated **Accordo di Servizio**. Request **Passaggio in produzione** and confirm the channel's production state in the portal.

The current procedure is documented under [Processo per nuovo accreditamento](https://www.fatturapa.gov.it/it/SistemaAccreditamento/processo-per-nuovo-accreditamento/). Older instructions about a signed ZIP sent by PEC describe a previous process and should not be used as the starting procedure.

The interoperability phase may use six-character PA test codes even when your eventual business use is B2B. The official process explains this. Test invoices do not become real fiscal invoices.

### 5. Request and register the receiving code

After production activation of a receiving channel, use the accreditation system's **Richiesta codici destinatario B2B** function. Follow its current instructions and record the seven-character code assigned to your channel. If the function is unavailable, verify the selected company, your operator permission, the channel's receiving direction and its production status.

Return to [Fatture e Corrispettivi](https://ivaservizi.agenziaentrate.gov.it/) and register that code as the company's receiving address, following Route A steps 2–5. A recipient-code request and a taxpayer's address registration are two separate operations.

**What you should have at the end:** an active receiving channel, its assigned code, the accepted agreement, monitored endpoints, protected certificates and a registered company receiving address. Finish the business import/reconciliation and production activation work, then verify authorized production reception before moving suppliers to the channel. The deployed TEST receiver alone does not satisfy this outcome.

## Enable mass-download services separately

SMTS provides historical/bulk data retrieval and stamp-duty workflows. It requires additional setup even if the normal channel already works:

1. Confirm the provider has an accredited SdICoop channel.
2. In **Fatture e Corrispettivi → Consultazione**, open **Censimento canali per forniture massive** and enable the intended provider for the taxpayer and services concerned.
3. If acting for another taxpayer, obtain and verify the relevant delegation. A company membership in OpenFatture is not a delegation on the Agenzia portal.
4. Arrange qualified signing of requests by the taxpayer or delegated intermediary. The transport certificate and the qualified request signature serve different purposes.
5. Implement request submission, status checks, archive download, integrity checks and deadlines against the official SMTS v1.5 files.

Downloading certain received invoices through this service constitutes **presa visione**. The future connector must explain that consequence before the user authorizes the download and record the action. The app currently saves only local request drafts. See the [official SMTS page and technical files](https://www.agenziaentrate.gov.it/portale/servizi-massivi-sdicoop).

## Configure OpenFatture for one company or many

The **server** feature flag is authoritative. The browser flag only controls presentation.

| Setting | Multiple companies | One self-hosted company |
| --- | --- | --- |
| API `MULTI_TENANT` | `true` (default) | `false` |
| API `SELF_HOSTED_COMPANY_ID` | Not required | Required, for example `company_acme` |
| Web `/config.json` | `features.multiTenant: true` | `features.multiTenant: false` |
| AWS CDK context | `-c multiTenant=true` | `-c multiTenant=false -c selfHostedCompanyId=company_acme` |

In both modes, production uses Cognito and stored company memberships. Single-company mode rejects access to every other company, even if the user has another membership. It does not bypass login. Multi-tenant mode lets a user select only companies to which the server has granted membership.

For local single-company demonstration, start the API with `MULTI_TENANT=false SELF_HOSTED_COMPANY_ID=company_demo` and set `features.multiTenant` to `false` in `apps/web/public/config.json`. Production configuration is generated by CDK, keeping both flags aligned. See [AWS deployment](../infra/README.md) and [local setup](../README.md).

Changing the flag does not migrate, merge or delete company records. Restrict access and plan memberships before changing a running installation. It also does not grant provider accreditation or enable live fiscal submissions.

## Common problems

| What you see | What to check |
| --- | --- |
| Company missing after accreditation login | Company's telematic registration and the operator's incarico |
| Cannot request a B2B code | Receiving direction and production activation, then operator permissions |
| Supplier invoice goes to the previous service | Registered receiving address, provider cutover and invoice routing details |
| OpenFatture says no company access | Provision a company and Cognito-sub membership; check the single-company pin |
| Bulk request remains waiting for configuration | Expected in this release; qualified signing and a live SMTS adapter are still needed |
| Files are backed up but not conserved | Arrange a compliant conservation service separately |

Keep credentials with the people authorized to use them. The company administrator handles portal authorizations; the IT administrator handles service operations; the accounting contact confirms the fiscal workflow and preservation arrangements.
