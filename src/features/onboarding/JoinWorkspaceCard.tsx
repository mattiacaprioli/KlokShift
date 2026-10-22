import { useState } from "react";
import { Share } from "react-native";
import { Text, View } from "@/tw";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Mono } from "@/components/ui/Mono";
import { useAuth } from "@/lib/auth";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";

/**
 * Il professionista che non è ancora in nessun organico: cosa deve fare.
 *
 * L'aggancio lo fa da solo `link_member_invites` quando la sede scrive questa
 * email sulla scheda (e l'email è confermata): l'unica mossa della persona è
 * dirgliela giusta. Prima lo spiegava solo una FAQ in Aiuto, e la Home diceva
 * «quando una sede ti assegna un turno lo trovi qui» — vero, ma senza dire come.
 *
 * Niente `expo-clipboard` (servirebbe una nuova build nativa): l'email è
 * selezionabile, e «Condividi» la manda dove serve, WhatsApp compreso.
 */
export function JoinWorkspaceCard() {
  const { session } = useAuth();
  const { refetch } = useOwnerVenues();
  const [checking, setChecking] = useState(false);
  const email = session?.user.email;
  if (!email) return null;

  const check = async () => {
    setChecking(true);
    try {
      await refetch();
    } finally {
      setChecking(false);
    }
  };

  const share = () =>
    void Share.share({
      message: `Ciao! Per aggiungermi ai turni su KlokShift usa questa email: ${email}`,
    }).catch(() => undefined);

  return (
    <View className="gap-4 rounded-3xl border border-border-gold bg-bg-card p-5">
      <View>
        <Mono gold>Primo passo</Mono>
        <Text className="mt-1 font-sans-bold text-lg text-t1">
          Fatti aggiungere dalla tua sede
        </Text>
        <Text className="mt-1 text-sm leading-5 text-t2">
          Chiedi a chi organizza i turni di aggiungerti con questa email:
        </Text>
      </View>
      <View className="rounded-2xl border border-border-2 bg-bg-1 px-4 py-3">
        <Text selectable className="text-center font-sans-semibold text-[15px] text-t1">
          {email}
        </Text>
      </View>
      <Text className="text-[13px] leading-5 text-t3">
        Appena ti aggiunge trovi qui la sede e i tuoi turni: non c&apos;è niente da
        accettare. Se ha usato un&apos;altra email, chiedile di correggerla sulla
        tua scheda.
      </Text>
      <View className="gap-2">
        <GoldButton label="Condividi la mia email" onPress={share} />
        <GhostButton
          label={checking ? "Controllo…" : "Controlla di nuovo"}
          disabled={checking}
          onPress={() => void check()}
        />
      </View>
    </View>
  );
}
