import type { IconName } from "@/components/ui/Icon";
import type { Enums } from "@/types/database";

type Role = Enums<"user_role">;

export type IntroSlide = {
  icon: IconName;
  title: string;
  body: string;
};

// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LE FEATURE
// Questo è il testo mostrato UNA VOLTA ai nuovi utenti al primo avvio (per ruolo).
// È l'unica fonte della copy di onboarding: se cambi/aggiungi/togli una feature,
// AGGIORNA queste slide, altrimenti l'onboarding racconta un'app che non esiste più.
// Quando la monetizzazione sarà attiva, il "benvenuto in Pro" (mostrato al passaggio
// free→pro) vivrà qui accanto come PRO_INTRO_SLIDES, riusando lo stesso IntroCarousel.

export const INTRO_SLIDES: Record<Role, IntroSlide[]> = {
  waiter: [
    {
      icon: "calendar",
      title: "I tuoi turni, sempre con te",
      body: "Le sedi per cui lavori ti assegnano i turni: li confermi con un tocco e li hai tutti qui.",
    },
    {
      icon: "clock",
      title: "Le tue ore, già contate",
      body: "Ogni turno svolto entra nel tuo monte ore. Sai quanto hai lavorato senza rifare i conti.",
    },
    {
      icon: "message",
      title: "Nessuna sorpresa all'ultimo",
      body: "Se un turno cambia o salta lo sai subito, e con la sede ci parli direttamente da qui.",
    },
  ],
  manager: [
    {
      icon: "users",
      title: "Organizza i turni col tuo staff",
      body: "Crea il tuo organico e assegna i turni in pochi tocchi.",
    },
    {
      icon: "clipboard",
      title: "Copertura sotto controllo",
      body: "Fabbisogno per ruolo, turni scoperti e ore lavorate, turno per turno.",
    },
    {
      icon: "sparkle",
      title: "Tutto sotto controllo",
      body: "Ore, copertura, chat e reputazione del tuo staff in un posto solo.",
    },
  ],
};
