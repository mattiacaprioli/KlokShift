import { ActivityIndicator } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

/**
 * Foto scelta dall'utente: anteprima tonda in anello dorato, pastiglia con la
 * macchina fotografica, e le due azioni testuali sotto.
 *
 * Sta qui e non nella schermata del profilo perché la stessa cosa serve al
 * sede per il suo logo: sono lo stesso gesto sullo stesso bucket, e tenerne
 * due copie voleva dire due comportamenti che divergono al primo ritocco.
 * Il caricamento vero (scelta, ritaglio, upload) resta a chi chiama — questo
 * componente non sa da dove arriva l'immagine né dove va a finire.
 */
export function AvatarPickerField({
  uri,
  name,
  busy,
  onPick,
  onRemove,
  size = 96,
  addLabel = "Aggiungi foto",
  changeLabel = "Cambia foto",
}: {
  uri?: string | null;
  /** Serve al fallback con le iniziali quando non c'è ancora una foto. */
  name: string;
  busy?: boolean;
  onPick: () => void;
  /** Assente = la foto non si può togliere. */
  onRemove?: () => void;
  size?: number;
  addLabel?: string;
  changeLabel?: string;
}) {
  return (
    <View className="items-center gap-2">
      <View
        style={{
          borderWidth: 2,
          borderColor: "rgba(234,181,76,0.5)",
          borderRadius: 999,
          padding: 3,
        }}
      >
        <View>
          <Avatar uri={uri} name={name} size={size} />
          <Pressable
            onPress={onPick}
            disabled={busy}
            className="absolute -bottom-1 -right-1 h-9 w-9 items-center justify-center rounded-full border-2 border-bg-0 bg-bg-2"
            accessibilityRole="button"
            accessibilityLabel={uri ? changeLabel : addLabel}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#EAB54C" />
            ) : (
              <Icon name="camera" size={16} color="#EAB54C" />
            )}
          </Pressable>
        </View>
      </View>
      <View className="flex-row items-center gap-4">
        <Pressable onPress={onPick} hitSlop={6} disabled={busy}>
          <Text className="font-sans-semibold text-sm text-gold">
            {busy ? "Caricamento…" : uri ? changeLabel : addLabel}
          </Text>
        </Pressable>
        {uri && onRemove && !busy ? (
          <Pressable onPress={onRemove} hitSlop={6}>
            <Text className="font-sans text-sm text-t3">Rimuovi</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
