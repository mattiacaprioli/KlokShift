import { Icon } from "@/components/ui/Icon";
import { Pressable, Text, View } from "@/tw";
import { useIsPro, useProGate } from "./hooks";

/**
 * Badge compatto "PRO" con lucchetto — da mettere in coda a un entry point
 * bloccato (es. al posto del chevron su una Card). Puramente visivo.
 */
export function ProBadge() {
  return (
    <View className="flex-row items-center gap-1 rounded-full border border-border-gold bg-bg-2 px-2 py-1">
      <Icon name="lock" size={12} color="#EAB54C" />
      <Text className="font-mono text-[10px] uppercase tracking-widest text-gold">
        Pro
      </Text>
    </View>
  );
}

/**
 * Riga "Piano" per il profilo/impostazioni: mostra lo stato Pro/Free e porta al
 * paywall (per scoprire cosa include o, in futuro, gestire l'abbonamento).
 */
export function PlanCard() {
  const isPro = useIsPro();
  const { openPaywall } = useProGate();
  return (
    <Pressable
      onPress={openPaywall}
      className="flex-row items-center gap-3 rounded-3xl border border-border-gold bg-bg-card p-4"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full border border-border-gold bg-bg-2">
        <Icon name="sparkle" size={18} color="#EAB54C" />
      </View>
      <View className="flex-1">
        <Text className="text-base font-sans-bold text-t1">KlokShift Pro</Text>
        <Text className="mt-0.5 text-xs text-t3">
          {isPro
            ? "Gestione del personale attiva."
            : "Sblocca la gestione completa del personale."}
        </Text>
      </View>
      {isPro ? (
        <View className="flex-row items-center gap-1 rounded-full border border-border-gold bg-bg-2 px-2 py-1">
          <Icon name="check" size={12} color="#EAB54C" />
          <Text className="font-mono text-[10px] uppercase tracking-widest text-gold">
            Attivo
          </Text>
        </View>
      ) : (
        <Icon name="chevR" size={18} color="#8c857a" />
      )}
    </Pressable>
  );
}

/**
 * Card di upsell mostrata SOLO agli utenti Free (nulla per i Pro) — es. in Home
 * per la scoperta. Al tap apre il paywall.
 */
export function ProUpsellCard() {
  const isPro = useIsPro();
  const { openPaywall } = useProGate();
  if (isPro) return null;
  return (
    <Pressable
      onPress={openPaywall}
      className="flex-row items-center gap-3 rounded-3xl border border-border-gold bg-bg-card p-4"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full border border-border-gold bg-bg-2">
        <Icon name="sparkle" size={18} color="#EAB54C" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-sans-bold text-t1">Passa a Pro</Text>
          <ProBadge />
        </View>
        <Text className="mt-0.5 text-xs text-t3">
          Ore, presenze e performance del tuo staff.
        </Text>
      </View>
      <Icon name="chevR" size={18} color="#8c857a" />
    </Pressable>
  );
}

/**
 * Card che sostituisce una sezione Pro quando l'utente è Free: mostra il
 * contenuto "velato" (titolo + descrizione di cosa si sblocca) con lucchetto,
 * e al tap apre il paywall. Visibile ma bloccata → l'utente sa cosa si perde.
 */
export function ProLockedCard({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  const { openPaywall } = useProGate();
  return (
    <Pressable
      onPress={openPaywall}
      className="rounded-3xl border border-border-gold bg-bg-card p-4"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full border border-border-gold bg-bg-2">
          <Icon name="lock" size={18} color="#EAB54C" />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-sans-bold text-t1">{title}</Text>
            <ProBadge />
          </View>
          <Text className="mt-0.5 text-xs text-t3">{subtitle}</Text>
        </View>
        <Icon name="chevR" size={18} color="#8c857a" />
      </View>
    </Pressable>
  );
}
