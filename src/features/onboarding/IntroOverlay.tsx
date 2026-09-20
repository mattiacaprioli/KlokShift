import { useState } from "react";
import { StyleSheet } from "react-native";
import { View } from "@/tw";
import { useAuth } from "@/lib/auth";
import { useViewMode } from "@/features/team/ViewMode";
import { INTRO_SLIDES } from "./introContent";
import { IntroCarousel } from "./IntroCarousel";
import { markIntroSeen } from "./api";

/**
 * Overlay a schermo intero con l'intro di primo utilizzo, mostrato una
 * volta sola quando `profiles.intro_seen` è false. Il contenuto lo sceglie la
 * **vista attiva** (gestione / lavoro), non un ruolo sul profilo. Montato nel
 * root layout sopra lo Stack (niente rotte → nessun impatto sul typed-routes).
 * Chi lavora lo vede dopo il wizard di setup profilo; chi gestisce al primo
 * ingresso.
 */
export function IntroOverlay() {
  const { session, profile, refreshProfile } = useAuth();
  const { effective } = useViewMode();
  const [dismissing, setDismissing] = useState(false);

  if (!session || !profile || profile.intro_seen) return null;
  // Chi lavora passa prima dal wizard di setup: intro solo a setup fatto.
  if (effective === "waiter" && !profile.onboarding_complete) return null;
  // L'intro è decorativa: se per qualsiasi motivo non c'è una serie di slide
  // per la vista attiva, si salta invece di portare giù l'app con sé.
  const slides = INTRO_SLIDES[effective];
  if (!slides?.length) return null;

  async function done() {
    if (dismissing) return;
    setDismissing(true);
    try {
      await markIntroSeen(session!.user.id);
    } catch {
      // Best-effort: se fallisce lo rivedrà, non è bloccante.
    }
    await refreshProfile();
  }

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]}>
      <IntroCarousel slides={slides} onDone={done} />
    </View>
  );
}
