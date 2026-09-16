// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LA FEATURE ASSENZE
// Sono i testi delle guide «Ferie, permessi e malattia» nelle impostazioni: del
// titolare (app e dashboard) e del professionista (app). Descrivono il flusso
// com'è oggi nel codice: se cambi le RPC (`request_absence`, `resolve_absence`,
// `withdraw_absence`, `record_absence`), i conflitti con i turni
// (`conflicts.ts`, «Togli dai turni»), il planning o l'export della pagina Ore,
// AGGIORNA queste righe, altrimenti la guida spiega un'app che non esiste più.
//
// Solo dati, nessun import di React Native: la dashboard web lo riusa così com'è.

import type { Tutorial } from "@/features/team/tutorialContent";

export const ABSENCE_MANAGER_TUTORIAL: Tutorial = {
  title: "Ferie, permessi e malattia",
  intro:
    "I tuoi professionisti chiedono ferie e permessi, e comunicano la malattia, direttamente dall'app. Tu decidi da una card in chat, vedi chi manca nel planning e a fine mese trovi tutto nell'export per il commercialista.",
  sections: [
    {
      title: "Quando arriva una richiesta",
      steps: [
        "Ricevi una notifica e trovi la richiesta in chat con quella persona. Le richieste da decidere compaiono anche nella Home, nel blocco «Richieste».",
        "Apri la richiesta: vedi date, motivo e i turni in cui la persona è già assegnata in quei giorni.",
        "Scegli «Approva e togli dai turni» per liberare quei posti, oppure «Approva, i turni li sistemo io». Se non ci sono turni in conflitto c'è solo «Approva».",
        "Se non va bene, «Rifiuta». La nota è facoltativa e la legge chi ha chiesto.",
      ],
    },
    {
      title: "La malattia",
      points: [
        "Non si approva: il professionista la comunica e tu la vedi subito, in chat e nella Home.",
        "Se in quei giorni la persona è in turno, sulla card trovi «Togli dai turni»: il turno resta, scoperto, e puoi cercare chi copre.",
        "Si salvano solo le date e, se c'è, il numero di protocollo del certificato INPS. Mai diagnosi o altre informazioni sulla salute.",
        "Il protocollo arriva spesso dopo la visita: lo aggiunge il professionista o lo aggiungi tu dalla scheda della persona.",
      ],
    },
    {
      title: "Registrare un'assenza al posto suo",
      steps: [
        "Apri Staff, poi la persona, e vai alla sezione «Assenze».",
        "Premi «Registra assenza»: tipo, date e, per un permesso, anche l'orario.",
        "Nasce già approvata e senza messaggio in chat. Va bene per una malattia comunicata al telefono, per ferie concordate a voce, o per chi non ha l'app.",
      ],
    },
    {
      title: "Nel planning",
      points: [
        "Nella vista per persona della dashboard i giorni di assenza sono tratteggiati, più chiari se la richiesta è ancora da decidere, e un turno che cade in un'assenza approvata ha il bordo arancione. In app il pallino del giorno è tratteggiato e sotto il nome c'è l'assenza.",
        "Se assegni o passi un turno a chi è assente vedi un avviso, ma puoi procedere: magari le ferie sono state spostate a voce.",
        "Approvare non toglie mai nessuno dai turni da solo. Chi viene tolto riceve «Turno revocato», e il turno resta da coprire.",
      ],
    },
    {
      title: "A fine mese",
      points: [
        "Nella pagina Ore trovi «Assenze del mese»: giorni di ferie, giorni e ore di permesso, giorni di malattia con i protocolli INPS.",
        "Il PDF delle ore contiene anche la tabella delle assenze; il CSV delle assenze è un file a parte, così quello delle ore resta com'è.",
        "Si contano solo le assenze approvate, in giorni di calendario compresi i festivi: il conteggio dei giorni lavorativi lo fa il consulente del lavoro.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "Chi lavora in più sedi della tua azienda chiede una volta sola, e l'assenza vale per tutte.",
        "Un collaboratore vede e decide le assenze solo con il permesso sull'organico. Con i soli turni vede nel planning che una persona non è disponibile, ma non il motivo.",
        "Il saldo delle ferie maturate e residue non lo calcola l'app: resta al consulente del lavoro.",
      ],
    },
  ],
};

export const ABSENCE_WAITER_TUTORIAL: Tutorial = {
  title: "Ferie, permessi e malattia",
  intro:
    "Chiedi ferie e permessi, e comunica la malattia, senza messaggi o telefonate: la richiesta arriva al titolare in chat e la sua risposta arriva a te.",
  sections: [
    {
      title: "Chiedere ferie o un permesso",
      steps: [
        "Vai su Profilo → «Ferie, permessi e malattia», oppure in fondo alla tab Turni.",
        "Premi «Nuova richiesta» e scegli Ferie o Permesso.",
        "Scegli le date. Per un permesso di poche ore scegli «A ore» e indica l'orario.",
        "Se lavori per più aziende, scegli a quale mandarla: ognuna decide per sé.",
        "Aggiungi un motivo se vuoi e premi «Invia al titolare».",
      ],
    },
    {
      title: "Comunicare la malattia",
      steps: [
        "Nuova richiesta, poi Malattia, e le date. Puoi indicare anche giorni già passati.",
        "Se ce l'hai, scrivi il numero di protocollo del certificato INPS. Puoi aggiungerlo anche dopo, dalla lista delle tue assenze.",
        "Invia: il titolare la vede subito, non c'è niente da approvare.",
      ],
    },
    {
      title: "Dopo l'invio",
      points: [
        "Quando il titolare risponde ti arriva una notifica, e la risposta compare nella chat con lui.",
        "Finché la richiesta è in attesa puoi ritirarla. Un'assenza già approvata puoi annullarla solo se non è ancora cominciata, e il titolare viene avvisato.",
        "I turni che hai già in quei giorni non spariscono da soli: li sistema il titolare. Nell'agenda li vedi segnati con «Sei in ferie» o simile.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "Per la malattia non scrivere mai diagnosi o informazioni sulla tua salute: al titolare servono solo le date.",
        "I tuoi colleghi non vedono le tue assenze né il loro motivo.",
      ],
    },
  ],
};
