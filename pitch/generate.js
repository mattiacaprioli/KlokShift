const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const Fi = require("react-icons/fi");

// ---------- palette ----------
const C = {
  bg: "141019",       // deep warm charcoal
  bg2: "1E1826",      // panel
  card: "241D2E",     // card
  gold: "D4A24C",     // warm gold accent (AURA)
  goldLt: "E9CB88",
  cream: "F4EDE1",
  muted: "A79E93",
  line: "352C42",
  green: "8FB98A",
  rose: "C98A7E",
};
const SERIF = "Cambria";
const SANS = "Calibri";

// ---------- icon rasterizer ----------
const iconCache = {};
async function icon(name, color) {
  const key = name + color;
  if (iconCache[key]) return iconCache[key];
  const Comp = Fi[name];
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color: "#" + color, size: 256, strokeWidth: 2 })
  );
  const png = await sharp(Buffer.from(svg)).resize(256, 256).png().toBuffer();
  const data = "image/png;base64," + png.toString("base64");
  iconCache[key] = data;
  return data;
}

(async () => {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
  p.defineSlideMaster({ title: "BG", background: { color: C.bg } });
  const W = 13.333, H = 7.5;

  // helper: gold circle with icon
  async function iconCircle(s, x, y, d, iconName, circleColor = C.gold, iconColor = C.bg) {
    s.addShape("ellipse", { x, y, w: d, h: d, fill: { color: circleColor } });
    const pad = d * 0.26;
    s.addImage({ data: await icon(iconName, iconColor), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad });
  }

  function kicker(s, txt, x, y, color = C.gold) {
    s.addText(txt.toUpperCase(), { x, y, w: 8, h: 0.3, fontFace: SANS, fontSize: 12, bold: true, color, charSpacing: 3, align: "left" });
  }

  // ============================================================ SLIDE 1 — COVER
  {
    const s = p.addSlide({ masterName: "BG" });
    // faint monogram motif
    s.addShape("ellipse", { x: 9.7, y: -2.2, w: 6.5, h: 6.5, fill: { color: C.gold, transparency: 88 }, line: { type: "none" } });
    s.addShape("ellipse", { x: 11.2, y: 3.6, w: 5.2, h: 5.2, fill: { color: C.gold, transparency: 92 }, line: { type: "none" } });

    s.addText([
      { text: "top", options: { color: C.cream, bold: true } },
      { text: "Waitr", options: { color: C.gold, bold: true } },
    ], { x: 0.9, y: 2.15, w: 8, h: 1.1, fontFace: SERIF, fontSize: 60, align: "left", margin: 0 });

    s.addText("Il marketplace dei turni per la ristorazione", {
      x: 0.92, y: 3.25, w: 9.5, h: 0.6, fontFace: SANS, fontSize: 22, color: C.cream, align: "left", margin: 0,
    });
    s.addText("Camerieri e ristoratori, connessi. Organizza il tuo staff, copri gli extra all'ultimo minuto e costruisci una reputazione che vale.", {
      x: 0.92, y: 3.9, w: 8.6, h: 1, fontFace: SANS, fontSize: 15, color: C.muted, align: "left", margin: 0, lineSpacingMultiple: 1.2,
    });

    kicker(s, "Presentazione progetto  ·  Mercato italiano", 0.92, 6.5);
    s.addNotes("Deck di presentazione di KlokShift per ristoratori/aziende. Tema premium scuro con accento oro coerente col design system dell'app.");
  }

  // ============================================================ SLIDE 2 — PROBLEMA
  {
    const s = p.addSlide({ masterName: "BG" });
    kicker(s, "Il problema", 0.9, 0.6);
    s.addText("Gestire il personale di sala è un lavoro a parte", {
      x: 0.9, y: 0.95, w: 8.2, h: 1.3, fontFace: SERIF, fontSize: 34, bold: true, color: C.cream, align: "left", margin: 0, lineSpacingMultiple: 1.05,
    });

    const rows = [
      ["FiClock", "Buchi all'ultimo minuto", "Un cameriere dà forfait la sera stessa e trovare un sostituto affidabile diventa un problema."],
      ["FiRefreshCw", "Turnover alto, poca memoria", "Chi è affidabile? Chi ha già lavorato bene? L'informazione vive su fogli, chat e teste diverse."],
      ["FiFileText", "Ore e presenze a mano", "Presenze su carta, conteggio ore per il commercialista, copertura per ruolo: tutto manuale."],
    ];
    let y = 2.55;
    for (const [ic, t, d] of rows) {
      s.addShape("roundRect", { x: 0.9, y, w: 11.5, h: 1.25, rectRadius: 0.1, fill: { color: C.bg2 }, line: { type: "none" } });
      await iconCircle(s, 1.2, y + 0.30, 0.65, ic);
      s.addText(t, { x: 2.15, y: y + 0.22, w: 4.1, h: 0.5, fontFace: SANS, fontSize: 17, bold: true, color: C.cream, align: "left", margin: 0, valign: "middle" });
      s.addText(d, { x: 6.35, y: y + 0.18, w: 5.85, h: 0.9, fontFace: SANS, fontSize: 13, color: C.muted, align: "left", margin: 0, valign: "middle", lineSpacingMultiple: 1.1 });
      y += 1.45;
    }
    s.addNotes("Il dolore del ristoratore: coperture last-minute, turnover, gestione manuale di ore/presenze.");
  }

  // ============================================================ SLIDE 3 — SOLUZIONE
  {
    const s = p.addSlide({ masterName: "BG" });
    // left dark panel with statement
    s.addShape("rect", { x: 0, y: 0, w: 5.5, h: H, fill: { color: C.bg2 }, line: { type: "none" } });
    kicker(s, "La soluzione", 0.7, 0.85);
    s.addText([
      { text: "Una sola app per ", options: { color: C.cream } },
      { text: "organizzare, ", options: { color: C.gold } },
      { text: "coprire ", options: { color: C.gold } },
      { text: "e ", options: { color: C.cream } },
      { text: "farti scegliere", options: { color: C.gold } },
      { text: ".", options: { color: C.cream } },
    ], { x: 0.7, y: 1.35, w: 4.4, h: 3, fontFace: SERIF, fontSize: 30, bold: true, align: "left", margin: 0, lineSpacingMultiple: 1.1 });
    s.addText("KlokShift unisce la gestione del tuo staff interno al marketplace degli extra, con la reputazione dei camerieri al centro.", {
      x: 0.7, y: 5.0, w: 4.4, h: 1.4, fontFace: SANS, fontSize: 14, color: C.muted, align: "left", margin: 0, lineSpacingMultiple: 1.25,
    });

    const pillars = [
      ["FiUsers", "Il tuo staff", "Organico, turni interni, conferme e copertura per ruolo — in un colpo d'occhio."],
      ["FiSearch", "Extra su richiesta", "Pubblichi un turno, i camerieri si candidano, tu accetti. Nessun giro di telefonate."],
      ["FiStar", "Reputazione reale", "Recensioni dai clienti finali: scegli chi ha già dimostrato di valere."],
    ];
    let y = 1.15;
    for (const [ic, t, d] of pillars) {
      await iconCircle(s, 6.1, y, 0.7, ic);
      s.addText(t, { x: 7.05, y: y - 0.05, w: 5.5, h: 0.5, fontFace: SANS, fontSize: 19, bold: true, color: C.cream, align: "left", margin: 0 });
      s.addText(d, { x: 7.05, y: y + 0.42, w: 5.6, h: 0.9, fontFace: SANS, fontSize: 13.5, color: C.muted, align: "left", margin: 0, lineSpacingMultiple: 1.15 });
      y += 1.85;
    }
    s.addNotes("Tre pilastri: staff interno, marketplace extra, reputazione.");
  }

  // ============================================================ SLIDE 4 — DUE RUOLI
  {
    const s = p.addSlide({ masterName: "BG" });
    kicker(s, "Come funziona", 0.9, 0.6);
    s.addText("Due lati, un ecosistema", { x: 0.9, y: 0.95, w: 10, h: 0.8, fontFace: SERIF, fontSize: 32, bold: true, color: C.cream, align: "left", margin: 0 });

    async function roleCard(x, ic, title, sub, items, accent) {
      const cw = 5.65, cy = 2.0, ch = 4.7;
      s.addShape("roundRect", { x, y: cy, w: cw, h: ch, rectRadius: 0.12, fill: { color: C.bg2 }, line: { type: "none" } });
      await iconCircle(s, x + 0.45, cy + 0.45, 0.8, ic, accent, C.bg);
      s.addText(title, { x: x + 1.45, y: cy + 0.42, w: cw - 1.7, h: 0.45, fontFace: SANS, fontSize: 21, bold: true, color: C.cream, align: "left", margin: 0 });
      s.addText(sub, { x: x + 1.45, y: cy + 0.88, w: cw - 1.7, h: 0.4, fontFace: SANS, fontSize: 12.5, color: accent, align: "left", margin: 0 });
      let iy = cy + 1.65;
      for (const it of items) {
        s.addImage({ data: await icon("FiCheck", accent), x: x + 0.5, y: iy + 0.03, w: 0.22, h: 0.22 });
        s.addText(it, { x: x + 0.85, y: iy - 0.08, w: cw - 1.25, h: 0.55, fontFace: SANS, fontSize: 13.5, color: C.cream, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
        iy += 0.62;
      }
    }
    await roleCard(0.9, "FiUser", "Il cameriere", "cerca turni · costruisce il CV", [
      "Trova e si candida ai turni pubblicati",
      "Profilo con esperienze e recensioni clienti",
      "Conferma i turni interni del suo locale",
      "Chat diretta e notifiche in tempo reale",
    ], C.gold);
    await roleCard(6.78, "FiCoffee", "Il ristoratore", "organizza · pubblica · sceglie", [
      "Gestisce l'organico e i turni interni",
      "Pubblica un extra e valuta i candidati",
      "Traccia ore, presenze e copertura",
      "Sceglie in base a reputazione e affidabilità",
    ], C.goldLt);
    s.addNotes("Marketplace a due lati: cameriere e ristoratore.");
  }

  // ============================================================ SLIDE 5 — PER IL RISTORATORE (2x2)
  {
    const s = p.addSlide({ masterName: "BG" });
    kicker(s, "Per il ristoratore", 0.9, 0.55);
    s.addText("La cassetta degli attrezzi per la sala", { x: 0.9, y: 0.9, w: 11, h: 0.8, fontFace: SERIF, fontSize: 30, bold: true, color: C.cream, align: "left", margin: 0 });

    const feats = [
      ["FiUsers", "Il mio staff", "Organico con o senza account: schede complete del tuo team, sempre a portata."],
      ["FiCalendar", "Turni interni & extra", "Chiami il tuo staff o cerchi un extra sul marketplace — stessa schermata."],
      ["FiGrid", "Copertura per ruolo", "\"2 Camerieri + 1 Sommelier\": vedi in tempo reale cosa manca a ogni turno."],
      ["FiClock", "Ore, presenze & export", "Presente/assente, ore lavorate, riepilogo mensile ed export PDF/CSV per il commercialista."],
    ];
    const positions = [[0.9, 2.0], [6.95, 2.0], [0.9, 4.55], [6.95, 4.55]];
    const cw = 5.45, ch = 2.25;
    for (let i = 0; i < feats.length; i++) {
      const [ic, t, d] = feats[i];
      const [x, y] = positions[i];
      s.addShape("roundRect", { x, y, w: cw, h: ch, rectRadius: 0.12, fill: { color: C.card }, line: { type: "none" } });
      await iconCircle(s, x + 0.42, y + 0.42, 0.72, ic);
      s.addText(t, { x: x + 1.35, y: y + 0.5, w: cw - 1.6, h: 0.5, fontFace: SANS, fontSize: 18, bold: true, color: C.cream, align: "left", margin: 0 });
      s.addText(d, { x: x + 0.42, y: y + 1.3, w: cw - 0.8, h: 0.85, fontFace: SANS, fontSize: 13, color: C.muted, align: "left", margin: 0, lineSpacingMultiple: 1.15 });
    }
    s.addNotes("Le 4 funzioni core lato gestione personale (candidate al piano Pro).");
  }

  // ============================================================ SLIDE 6 — RECENSIONI (fulcro)
  {
    const s = p.addSlide({ masterName: "BG" });
    s.addShape("rect", { x: 0, y: 0, w: W, h: H, fill: { color: C.bg2 }, line: { type: "none" } });
    kicker(s, "Il fulcro del prodotto", 0.9, 0.7);
    s.addText("La reputazione che il cameriere si porta dietro", {
      x: 0.9, y: 1.05, w: 7.2, h: 1.5, fontFace: SERIF, fontSize: 32, bold: true, color: C.cream, align: "left", margin: 0, lineSpacingMultiple: 1.05,
    });
    s.addText("Sono i clienti finali a lasciare la recensione — non il gestore. Ogni cameriere accumula un rating reale e portabile: la prova che ha già lavorato bene, ovunque.", {
      x: 0.9, y: 2.7, w: 6.9, h: 1.6, fontFace: SANS, fontSize: 15, color: C.muted, align: "left", margin: 0, lineSpacingMultiple: 1.3,
    });

    const steps = [
      ["FiSmartphone", "Il cliente scansiona il QR", "Un sito web dedicato, nessuna app da installare."],
      ["FiStar", "Lascia una recensione", "Voto e tag sul servizio ricevuto al tavolo."],
      ["FiTrendingUp", "Il rating cresce", "Reputazione verificabile e sempre aggiornata."],
    ];
    let y = 4.55;
    for (const [ic, t, d] of steps) {
      await iconCircle(s, 0.9, y, 0.58, ic);
      s.addText(t, { x: 1.6, y: y - 0.06, w: 6.3, h: 0.4, fontFace: SANS, fontSize: 14.5, bold: true, color: C.cream, align: "left", margin: 0 });
      s.addText(d, { x: 1.6, y: y + 0.33, w: 6.3, h: 0.4, fontFace: SANS, fontSize: 11.5, color: C.muted, align: "left", margin: 0 });
      y += 0.9;
    }

    // right stat panel
    s.addShape("roundRect", { x: 8.55, y: 1.05, w: 3.9, h: 5.4, rectRadius: 0.14, fill: { color: C.card }, line: { type: "none" } });
    s.addText("★ 4.9", { x: 8.55, y: 1.65, w: 3.9, h: 1.1, fontFace: SERIF, fontSize: 58, bold: true, color: C.gold, align: "center", margin: 0 });
    s.addText("rating medio del cameriere", { x: 8.55, y: 2.85, w: 3.9, h: 0.4, fontFace: SANS, fontSize: 12.5, color: C.muted, align: "center", margin: 0 });
    s.addShape("line", { x: 9.15, y: 3.5, w: 2.7, h: 0, line: { color: C.line, width: 1 } });
    s.addText([
      { text: "Gratis per sempre.\n", options: { bold: true, color: C.cream, fontSize: 16 } },
      { text: "Recensioni e marketplace sono l'esca che porta camerieri e ristoratori sulla piattaforma.", options: { color: C.muted, fontSize: 13 } },
    ], { x: 8.9, y: 3.75, w: 3.2, h: 2.5, fontFace: SANS, align: "center", margin: 0, lineSpacingMultiple: 1.25, valign: "top" });
    s.addNotes("Recensioni = fulcro. Cliente finale recensisce via QR/sito. Rating portabile. Gratuito come acquisizione.");
  }

  // ============================================================ SLIDE 7 — REALTIME (chat/push/notifiche)
  {
    const s = p.addSlide({ masterName: "BG" });
    kicker(s, "Sempre connessi", 0.9, 0.6);
    s.addText("Comunicazione in tempo reale", { x: 0.9, y: 0.95, w: 11, h: 0.8, fontFace: SERIF, fontSize: 32, bold: true, color: C.cream, align: "left", margin: 0 });

    const cards = [
      ["FiSearch", "Marketplace turni", "Pubblica un extra in pochi tocchi: ruolo, giorno, compenso. I candidati arrivano a te."],
      ["FiMessageCircle", "Chat integrata", "Una conversazione per coppia, stile messaggistica, per accordarti prima del turno."],
      ["FiBell", "Notifiche push", "Nuova candidatura, turno assegnato, messaggio: avvisi istantanei, anche ad app chiusa."],
    ];
    const cw = 3.75, ch = 3.9, y = 2.15;
    let x = 0.9;
    for (const [ic, t, d] of cards) {
      s.addShape("roundRect", { x, y, w: cw, h: ch, rectRadius: 0.12, fill: { color: C.bg2 }, line: { type: "none" } });
      await iconCircle(s, x + 0.5, y + 0.55, 0.95, ic);
      s.addText(t, { x: x + 0.45, y: y + 1.75, w: cw - 0.9, h: 0.5, fontFace: SANS, fontSize: 19, bold: true, color: C.cream, align: "left", margin: 0 });
      s.addText(d, { x: x + 0.45, y: y + 2.35, w: cw - 0.85, h: 1.3, fontFace: SANS, fontSize: 13.5, color: C.muted, align: "left", margin: 0, lineSpacingMultiple: 1.2 });
      x += cw + 0.35;
    }
    s.addText("Notifiche verificate end-to-end su dispositivo reale · realtime nativo su candidature, messaggi e turni", {
      x: 0.9, y: 6.5, w: 11.5, h: 0.4, fontFace: SANS, fontSize: 12, italic: true, color: C.gold, align: "left", margin: 0,
    });
    s.addNotes("Marketplace + chat realtime (M6) + push notifications (M7, verificate su device).");
  }

  // ============================================================ SLIDE 8 — MODELLO DI BUSINESS
  {
    const s = p.addSlide({ masterName: "BG" });
    kicker(s, "Modello di business", 0.9, 0.6);
    s.addText("Gratis per crescere, Pro per gestire", { x: 0.9, y: 0.95, w: 11, h: 0.8, fontFace: SERIF, fontSize: 30, bold: true, color: C.cream, align: "left", margin: 0 });

    async function planCard(x, ic, tag, tagColor, title, items, highlight) {
      const cw = 5.65, y = 2.05, ch = 4.55;
      s.addShape("roundRect", { x, y, w: cw, h: ch, rectRadius: 0.14, fill: { color: highlight ? C.card : C.bg2 }, line: highlight ? { color: C.gold, width: 1.5 } : { type: "none" } });
      await iconCircle(s, x + 0.45, y + 0.45, 0.75, ic, tagColor, C.bg);
      s.addText(tag.toUpperCase(), { x: x + 1.4, y: y + 0.5, w: 3, h: 0.35, fontFace: SANS, fontSize: 12, bold: true, color: tagColor, charSpacing: 2, align: "left", margin: 0 });
      s.addText(title, { x: x + 1.4, y: y + 0.82, w: cw - 1.7, h: 0.5, fontFace: SANS, fontSize: 18, bold: true, color: C.cream, align: "left", margin: 0 });
      let iy = y + 1.75;
      for (const it of items) {
        s.addImage({ data: await icon("FiCheck", tagColor), x: x + 0.5, y: iy + 0.04, w: 0.22, h: 0.22 });
        s.addText(it, { x: x + 0.85, y: iy - 0.06, w: cw - 1.25, h: 0.55, fontFace: SANS, fontSize: 13.5, color: C.cream, align: "left", margin: 0, lineSpacingMultiple: 1.05 });
        iy += 0.62;
      }
    }
    await planCard(0.9, "FiGift", "Free — l'esca", C.green, "Marketplace & Reputazione", [
      "Trova e pubblica turni extra",
      "Recensioni dai clienti finali",
      "Chat e notifiche in tempo reale",
      "Profilo e CV del cameriere",
    ], false);
    await planCard(6.78, "FiZap", "Pro — il ricavo", C.gold, "Gestione del personale", [
      "Ore, presenze ed export contabile",
      "Copertura e fabbisogno per ruolo",
      "Statistiche e affidabilità dello staff",
      "Strumenti avanzati per il ristoratore",
    ], true);
    s.addText("Telaio Pro già costruito · monetizzazione e pagamenti attivabili quando il mercato è pronto", {
      x: 0.9, y: 6.75, w: 11.5, h: 0.4, fontFace: SANS, fontSize: 12, italic: true, color: C.muted, align: "left", margin: 0,
    });
    s.addNotes("Freemium: marketplace/recensioni gratis (acquisizione), gestione personale = Pro a pagamento dal ristoratore. Nessuno Stripe nell'MVP.");
  }

  // ============================================================ SLIDE 9 — STATO / ROADMAP
  {
    const s = p.addSlide({ masterName: "BG" });
    kicker(s, "A che punto siamo", 0.9, 0.6);
    s.addText("Prodotto costruito, pronto allo store", { x: 0.9, y: 0.95, w: 11, h: 0.8, fontFace: SERIF, fontSize: 30, bold: true, color: C.cream, align: "left", margin: 0 });

    const done = [
      "Schema dati & sicurezza (RLS)",
      "Design system e autenticazione",
      "Flusso ristoratore & cameriere",
      "Recensioni + reputazione",
      "Chat realtime",
      "Notifiche push (verificate su device)",
    ];
    // left: done list
    s.addShape("roundRect", { x: 0.9, y: 2.05, w: 7.1, h: 4.55, rectRadius: 0.12, fill: { color: C.bg2 }, line: { type: "none" } });
    s.addText("Fatto", { x: 1.3, y: 2.3, w: 5, h: 0.45, fontFace: SANS, fontSize: 18, bold: true, color: C.green, align: "left", margin: 0 });
    let cy = 2.95, i = 0;
    for (const d of done) {
      const col = i % 2, row = Math.floor(i / 2);
      const cx = 1.3 + col * 3.35;
      const ry = 2.95 + row * 1.15;
      s.addImage({ data: await icon("FiCheckCircle", C.green), x: cx, y: ry + 0.02, w: 0.3, h: 0.3 });
      s.addText(d, { x: cx + 0.42, y: ry - 0.08, w: 2.95, h: 0.9, fontFace: SANS, fontSize: 13.5, color: C.cream, align: "left", margin: 0, valign: "top", lineSpacingMultiple: 1.05 });
      i++;
    }

    // right: next
    s.addShape("roundRect", { x: 8.25, y: 2.05, w: 4.15, h: 4.55, rectRadius: 0.12, fill: { color: C.card }, line: { color: C.gold, width: 1.2 } });
    await iconCircle(s, 8.6, 2.35, 0.7, "FiFlag");
    s.addText("Prossimo", { x: 9.5, y: 2.45, w: 2.7, h: 0.45, fontFace: SANS, fontSize: 18, bold: true, color: C.gold, align: "left", margin: 0 });
    const next = [
      "Pubblicazione su App Store e Play Store",
      "Onboarding dei primi locali pilota",
      "Attivazione del piano Pro & pagamenti",
    ];
    let ny = 3.55;
    for (const n of next) {
      s.addText("→", { x: 8.6, y: ny, w: 0.4, h: 0.7, fontFace: SANS, fontSize: 15, bold: true, color: C.gold, align: "left", valign: "middle", margin: 0 });
      s.addText(n, { x: 9.05, y: ny, w: 3.15, h: 0.7, fontFace: SANS, fontSize: 13.5, color: C.cream, align: "left", valign: "middle", margin: 0, lineSpacingMultiple: 1.1 });
      ny += 0.95;
    }
    s.addNotes("M0-M7 completati; M8 store submission è la prossima milestone. Piano Pro pronto per la monetizzazione.");
  }

  // ============================================================ SLIDE 10 — CTA
  {
    const s = p.addSlide({ masterName: "BG" });
    s.addShape("ellipse", { x: -2, y: 3.8, w: 6.5, h: 6.5, fill: { color: C.gold, transparency: 90 }, line: { type: "none" } });
    s.addText([
      { text: "Porta il tuo locale su ", options: { color: C.cream } },
      { text: "top", options: { color: C.cream, bold: true } },
      { text: "Waitr", options: { color: C.gold, bold: true } },
    ], { x: 0.9, y: 2.5, w: 11.5, h: 1.2, fontFace: SERIF, fontSize: 42, bold: true, align: "left", margin: 0 });
    s.addText("Organizza lo staff, copri gli extra e scegli chi ha già dimostrato di valere. Cerchiamo ristoratori pilota per la fase di lancio.", {
      x: 0.92, y: 3.75, w: 9.5, h: 1, fontFace: SANS, fontSize: 17, color: C.muted, align: "left", margin: 0, lineSpacingMultiple: 1.25,
    });
    await iconCircle(s, 0.92, 5.25, 0.5, "FiMail");
    s.addText("Parliamone  ·  demo su richiesta", { x: 1.55, y: 5.28, w: 8, h: 0.5, fontFace: SANS, fontSize: 15, bold: true, color: C.cream, align: "left", margin: 0, valign: "middle" });
    s.addNotes("Chiusura: call to action per ristoratori pilota. Sostituire con contatti reali prima della presentazione.");
  }

  await p.writeFile({ fileName: require("path").join(__dirname, "KlokShift.pptx") });
  console.log("done");
})();
