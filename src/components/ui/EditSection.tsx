import type { ReactNode } from "react";
import { Pressable, Text, View } from "@/tw";
import { cn } from "@/lib/cn";
import { GhostButton } from "./GhostButton";
import { GoldButton } from "./GoldButton";
import { Mono } from "./Mono";

/**
 * I pezzi di una sezione che si legge e, a richiesta, si modifica.
 *
 * Le schede (persona, sede, permessi) si aprono in **lettura**: si guardano
 * molto più spesso di quanto si cambino, e con i campi sempre aperti bastava un
 * tocco nel punto sbagliato per riscrivere un nome o un contratto. Si entra in
 * modifica con «Modifica», si esce con «Salva» o «Annulla».
 */

/** Titolo di sezione, con «Modifica» a destra quando la sezione è in lettura. */
export function EditSectionHeader({
  title,
  onEdit,
}: {
  title: string;
  onEdit?: () => void;
}) {
  return (
    <View className="min-h-8 flex-row items-center justify-between gap-3">
      <Mono>{title}</Mono>
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          className="rounded-full border border-border-2 bg-bg-2 px-4 py-1.5"
        >
          <Text className="text-sm font-sans-semibold text-gold">Modifica</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * La cornice di un form aperto: il bordo oro dice «qui stai cambiando
 * qualcosa», che coi campi sempre aperti non si distingueva dal leggere.
 */
export function EditPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <View
      className={cn(
        "gap-5 rounded-3xl border border-gold/40 bg-bg-card p-5",
        className
      )}
    >
      {children}
    </View>
  );
}

/**
 * Salva e Annulla. Salva resta spento finché non è cambiato niente: un bottone
 * acceso che non fa niente insegna a premerlo senza guardare.
 */
export function EditActions({
  pending,
  canSave,
  onSave,
  onCancel,
  saveLabel = "Salva",
}: {
  pending: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  return (
    <View className="gap-3">
      <GoldButton
        label={pending ? "Salvataggio…" : saveLabel}
        disabled={pending || !canSave}
        onPress={onSave}
      />
      <GhostButton label="Annulla" disabled={pending} onPress={onCancel} />
    </View>
  );
}

/** Una riga in lettura: etichetta sopra, valore sotto, «—» se manca. */
export function ReadField({
  label,
  value,
  first,
}: {
  label: string;
  value: string | null | undefined;
  /** Prima riga della card: niente bordo superiore. */
  first?: boolean;
}) {
  const empty = !value;
  return (
    <View className={cn("gap-1 py-3", !first && "border-t border-border")}>
      <Text className="text-xs uppercase tracking-wider text-t3">{label}</Text>
      <Text
        className={cn(
          "text-[15px]",
          empty ? "text-t4" : "font-sans-semibold text-t1"
        )}
      >
        {empty ? "—" : value}
      </Text>
    </View>
  );
}

/** La card che raccoglie le `ReadField`. */
export function ReadCard({ children }: { children: ReactNode }) {
  return (
    <View className="rounded-3xl border border-border-2 bg-bg-card px-5 py-1">
      {children}
    </View>
  );
}
