# La guida rapida per la tua azienda

Vuoi gestire OpenFatture sui tuoi server? Puoi farlo sia usando il canale di un fornitore, sia preparando un tuo canale SdI. Le due scelte richiedono attività diverse.

## Vuoi solo ricevere le fatture con un fornitore?

1. Chiedi al fornitore il suo **codice destinatario di 7 caratteri**.
2. Accedi a [Fatture e Corrispettivi](https://ivaservizi.agenziaentrate.gov.it/) con un'utenza autorizzata per la tua azienda.
3. Seleziona l'azienda corretta.
4. Cerca **Registrazione dell'indirizzo telematico dove ricevere tutte le fatture elettroniche**.
5. Inserisci il codice del fornitore, conferma e verifica il messaggio di registrazione.
6. Comunica il codice ai fornitori e verifica la ricezione con il gestore del canale.

Questa operazione registra un indirizzo di ricezione. Per ottenere un codice assegnato al tuo canale, segui il percorso successivo.

## Vuoi un codice per un canale gestito dalla tua azienda?

Coinvolgi chi gestisce i tuoi sistemi informatici. Servono un servizio di ricezione, certificati e una persona incaricata della sua manutenzione.

1. Verifica l'abilitazione dell'azienda ai servizi telematici dell'Agenzia e l'autorizzazione dell'operatore.
2. Apri il [Sistema di Accreditamento](https://accreditamento.fatturapa.gov.it/).
3. Avvia la procedura per un canale Web Service abilitato alla **ricezione**, oppure SFTP.
4. Compila i dati dell'azienda, dell'accordo e dei referenti. Segui le istruzioni del portale per i certificati.
5. Completa i test tecnici, prendi visione dell'accordo e richiedi il passaggio in produzione.
6. Quando il canale di ricezione è attivo in produzione, richiedi i codici destinatario B2B dal sistema.
7. Registra il codice assegnato in Fatture e Corrispettivi, come spiegato sopra.

Il codice B2B ha **7 caratteri**. Il codice ufficio della Pubblica Amministrazione ne ha **6**. Il codice identifica il canale di ricezione; più aziende possono usare lo stesso canale di un fornitore.

Fonte: [procedura ufficiale di accreditamento](https://www.fatturapa.gov.it/it/SistemaAccreditamento/processo-per-nuovo-accreditamento/), verificata il 12 novembre 2026. Usa il portale corrente: le vecchie guide con invio di uno ZIP firmato tramite PEC descrivono una procedura precedente.

## Vuoi scaricare dati storici in massa?

I servizi massivi richiedono un'abilitazione distinta. In **Consultazione → Censimento canali per forniture massive**, abilita il provider per la tua azienda. Verifica le deleghe e organizza la firma qualificata delle richieste. Alcuni download di fatture ricevute valgono come **presa visione**: concorda il flusso con chi segue la contabilità.

Leggi i [requisiti ufficiali SMTS](https://www.agenziaentrate.gov.it/portale/servizi-massivi-sdicoop) e la [guida completa](self-hosting-and-sdi.md).

## Cosa deve configurare il tuo tecnico in OpenFatture?

- Per una sola azienda: `MULTI_TENANT=false` e `SELF_HOSTED_COMPANY_ID` uguale all'identificativo dell'azienda creata nell'app.
- Per più aziende: `MULTI_TENANT=true`. Ogni utente deve avere una specifica autorizzazione per ciascuna azienda.
- Su AWS, CDK genera la corrispondente configurazione dell'interfaccia. Accesso e autorizzazioni restano obbligatori in entrambe le modalità.

In questa versione puoi preparare documenti, registrare incassi e salvare richieste interne. Il collegamento fiscale diretto, la firma qualificata e la conservazione a norma devono ancora essere implementati. L'installazione dell'app non accredita automaticamente un canale e non genera un codice.

Per installare l'app: [istruzioni tecniche](../README.md). Per i passaggi dettagliati, i ruoli e la risoluzione dei problemi: [guida completa](self-hosting-and-sdi.md).
