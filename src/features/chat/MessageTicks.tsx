import { View } from "@/tw";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useColors } from "@/lib/theme";
import { MESSAGE_STATUS_LABEL, type MessageStatus } from "./messageStatus";

const ICON: Record<MessageStatus, IconName> = {
  sending: "clock",
  sent: "check",
  delivered: "checkDouble",
  read: "checkDouble",
};

/**
 * Le spunte di un mio messaggio, come su WhatsApp ma coi colori nostri: niente
 * blu, è l'intensità a dire «visualizzato» (pieno) contro il resto (attenuato).
 *
 * `tone="bubble"` sta sulla bolla oro (`text-gold-ink`); `tone="list"` sta
 * sulla card della lista chat, dove l'inchiostro dell'oro non si leggerebbe.
 */
export function MessageTicks({
  status,
  tone = "bubble",
}: {
  status: MessageStatus;
  tone?: "bubble" | "list";
}) {
  const colors = useColors();
  const read = status === "read";
  const color =
    tone === "bubble" ? colors.goldInk : read ? colors.gold : colors.t4;
  return (
    <View
      accessible
      accessibilityLabel={MESSAGE_STATUS_LABEL[status]}
      className={read ? undefined : "opacity-50"}
    >
      <Icon name={ICON[status]} size={14} color={color} />
    </View>
  );
}
