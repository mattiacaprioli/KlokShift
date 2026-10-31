// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LA FEATURE ASSENZE
// Sono i testi delle guide «Ferie, permessi e malattia» nelle impostazioni: del
// titolare (app e dashboard) e del dipendente (app). Descrivono il flusso
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
    "Le persone del tuo team chiedono ferie e permessi, e comunicano la malattia, direttamente dall'app. Tu decidi dalla Home o dalla pagina Assenze, vedi chi manca nei turni e a fine mese trovi tutto nell'export per il commercialista.",
  sections: [
    {
      title: "Quando arriva una richiesta",
      steps: [
        "Ricevi una notifica che apre la pagina Assenze. Le richieste da decidere compaiono anche nella Home, nel blocco «Richieste», e in Menu › Assenze (nella dashboard, la voce «Assenze» del menu), con il numero sul badge.",
        "Apri la richiesta: vedi date, motivo e i turni in cui la persona è già assegnata in quei giorni.",
        "Scegli «Approva e togli dai turni» per liberare quei posti, oppure «Approva, i turni li sistemo io». Se non ci sono turni in conflitto c'è solo «Approva».",
        "Se non va bene, «Rifiuta» (in app «Rifiuta la richiesta»). La nota è facoltativa e la legge chi ha chiesto.",
      ],
    },
    {
      title: "La malattia",
      points: [
        "Non si approva: il dipendente la comunica e tu ricevi una notifica e la vedi subito nella Home e in Assenze.",
        "Se in quei giorni la persona è in turno, sulla sua riga in Assenze trovi «Togli dai turni»: il turno resta, scoperto, e puoi cercare chi copre.",
        "Si salvano solo le date e, se c'è, il riferimento del certificato medico. Mai diagnosi o altre informazioni sulla salute.",
        "Il riferimento del certificato arriva spesso dopo la visita: lo aggiunge il dipendente o lo aggiungi tu dalla scheda della persona.",
      ],
    },
    {
      title: "Registrare un'assenza al posto suo",
      steps: [
        "Apri Team, poi la persona, e vai alla sezione «Assenze».",
        "Premi «Registra assenza»: tipo, date e, per un permesso, anche l'orario.",
        "Nasce già approvata e senza notifiche. Va bene per una malattia comunicata al telefono, per ferie concordate a voce, o per chi non ha l'app.",
      ],
    },
    {
      title: "Nei turni",
      points: [
        "Nella vista per persona della dashboard i giorni di assenza sono tratteggiati, più chiari se la richiesta è ancora da decidere, e un turno che cade in un'assenza approvata ha il bordo arancione. In app il pallino del giorno è tratteggiato e sotto il nome c'è l'assenza.",
        "Se assegni o passi un turno a chi è assente vedi un avviso, ma puoi procedere: magari le ferie sono state spostate a voce.",
        "Approvare non toglie mai nessuno dai turni da solo. Chi viene tolto riceve «Turno revocato», e il turno resta da coprire.",
      ],
    },
    {
      title: "A fine mese",
      points: [
        "Nella pagina Ore trovi «Assenze del mese»: giorni di ferie, giorni e ore di permesso, giorni di malattia con i riferimenti dei certificati medici.",
        "Il PDF delle ore contiene anche la tabella delle assenze. Il CSV delle ore ha colonne a parte per le ore riconosciute di ferie, malattia e permessi; il CSV delle assenze, con i giorni e i certificati, è un file a parte.",
        "Dalla scheda della persona puoi indicare le ore riconosciute di un'assenza («Ore riconosciute»): finiscono nel riepilogo ore, separate dalle ore lavorate. Le ore riconosciute in conflitto con ore lavorate risultano da verificare, non contate due volte.",
        "Si contano solo le assenze approvate, in giorni di calendario compresi i festivi: il conteggio dei giorni lavorativi lo fa il consulente del lavoro.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "Chi lavora in più sedi della tua azienda chiede una volta sola, e l'assenza vale per tutte.",
        "Un collaboratore vede e decide le assenze solo con il permesso «Team». Con i soli turni vede nei turni che una persona non è disponibile, ma non il motivo.",
        "Il saldo delle ferie maturate e residue non lo calcola l'app: resta al consulente del lavoro.",
      ],
    },
  ],
};

export const ABSENCE_WAITER_TUTORIAL: Tutorial = {
  title: "Ferie, permessi e malattia",
  intro:
    "Chiedi ferie e permessi, e comunica la malattia, senza messaggi o telefonate: la richiesta arriva alla sede e la risposta ti arriva con una notifica.",
  sections: [
    {
      title: "Chiedere ferie o un permesso",
      steps: [
        "Vai su Profilo → «Ferie, permessi e malattia».",
        "Premi «Nuova richiesta». Se lavori per più aziende, scegli prima a quale mandarla: ognuna decide per sé.",
        "Scegli Ferie o Permesso, poi le date. Per un permesso di poche ore scegli «A ore» e indica l'orario.",
        "Aggiungi un motivo se vuoi e premi «Invia alla sede».",
      ],
    },
    {
      title: "Comunicare la malattia",
      steps: [
        "Nuova richiesta, poi Malattia, e le date. Puoi indicare anche giorni già passati.",
        "Se ce l'hai, scrivi il riferimento del certificato medico. Puoi aggiungerlo anche dopo, dalla lista delle tue assenze.",
        "Invia: la sede la vede subito, non c'è niente da approvare.",
      ],
    },
    {
      title: "Dopo l'invio",
      points: [
        "Quando la sede risponde ti arriva una notifica, e la risposta la trovi in «Ferie, permessi e malattia».",
        "Finché la richiesta è in attesa puoi ritirarla. Un'assenza già approvata puoi annullarla solo se non è ancora cominciata, e la sede viene avvisata.",
        "I turni che hai già in quei giorni non spariscono da soli: li sistema la sede. Nell'agenda li vedi segnati con «Sei in ferie» o simile.",
      ],
    },
    {
      title: "Da sapere",
      points: [
        "Per la malattia non scrivere mai diagnosi o informazioni sulla tua salute: alla sede servono solo le date.",
        "I tuoi colleghi non vedono le tue assenze né il loro motivo.",
      ],
    },
  ],
};
