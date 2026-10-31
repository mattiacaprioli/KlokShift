# Prova a mano — accettazione di termini e DPA

Da fare dopo che la migration `20261102000000_legal_acceptances.sql` è applicata
(CI al push su `main`). Spec:
`docs/superpowers/specs/2026-10-31-dpa-e-pagine-legali-design.md` §6.3. Il banco
SQL (`supabase/tests/rls/150_legal_acceptances.sql`) copre le regole; qui si
guardano le schermate.

Stato atteso subito dopo la migration: **nessuna** azienda esistente ha
accettato, quindi ogni titolare e collaboratore trova il blocco.

## Procedura

1. **Titolare di un'azienda esistente**, dashboard web: dopo il login compare
   «Termini e accordo sul trattamento dei dati», con i link a termini e DPA.
   «Accetto» → si entra nella dashboard senza ricaricare.
2. **Stesso titolare nell'app**, vista gestione: nessun blocco (l'accettazione
   vale per l'azienda, non per il dispositivo).
3. **Collaboratore di un'azienda non ancora accettata** (app e web): testo
   «Il titolare di … deve accettare i nuovi termini…», nessun pulsante. Se ha
   anche turni, nell'app c'è «Passa ai tuoi turni» e la vista lavoro funziona.
4. **Dipendente**: nessun blocco, né nell'app né sulla dashboard (che per lui
   resta la pagina «per chi lavora»).
5. **Nuova azienda dall'app** (Profilo → «Apri la tua azienda», e la prima sede
   da `venue/new`) e **dal web** («Crea l'azienda»): il pulsante resta spento
   finché la casella non è spuntata; dopo la creazione nessun blocco.
6. **Registro**: dal SQL editor
   `select workspace_id, user_id, version, accepted_at from private.legal_acceptances order by accepted_at desc;`
   mostra una riga per azienda, con chi ha accettato.

## Esito

| Data | Passo | Esito | Note |
|---|---|---|---|
