import { useState } from "react";
import { ActivityIndicator, Modal, Switch } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { usePublishPreview, usePublishShifts } from "@/features/assignments/hooks";
import { formatDate } from "@/lib/format";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import {
  NOTIFY_HINT,
  PUBLISH_EMPTY,
  PUBLISH_ERROR,
  PUBLISH_PREVIEW_ERROR,
  SILENT_HINT,
  draftsCountLabel,
  nobodyToNotifyText,
  notifyLabel,
  outsideNote,
  publishCta,
  publishTitle,
  publishedToast,
} from "./drafts";

/**
 * «Pubblica» per la settimana: carica l'anteprima (cosa si pubblica e chi viene
 * avvisato) e pubblica **esattamente i turni dell'anteprima**, non quelli che
 * nel frattempo fossero comparsi.
 *
 * Gli avvisi sono un interruttore acceso di default, non un secondo pulsante:
 * con «Pubblica e avvisa» e «Pubblica senza avvisi» uno sotto l'altro non si
 * capiva quale fosse la strada normale. Gemello di `web/src/shifts/PublishDialog`.
 */
export function PublishModal({
  venueIds,
  from,
  to,
  visible,
  onClose,
}: {
  venueIds: string[];
  from: string;
  to: string;
  visible: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const preview = usePublishPreview(venueIds, from, to, visible);
  const publish = usePublishShifts();
  const [notify, setNotify] = useState(true);
  const data = preview.data;
  const ready = !!data && data.shift_ids.length > 0;
  const pending = publish.isPending;
  const note = data ? outsideNote(data.outside) : null;

  function submit() {
    if (!data || data.shift_ids.length === 0) return;
    publish.mutate(
      // Senza nessuno da avvisare l'interruttore non c'è: si pubblica in silenzio.
      { shiftIds: data.shift_ids, notify: notify && data.people > 0 },
      {
        onSuccess: (result) => {
          toast.show(publishedToast(result.published));
          onClose();
        },
        onError: (error) =>
          toast.show(userErrorMessage(error, PUBLISH_ERROR), "error"),
      }
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={pending ? undefined : onClose}
    >
      <Pressable
        onPress={pending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.66)" }}
        className="items-center justify-center px-5"
      >
        <Pressable
          onPress={() => {}}
          className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">
            {publishTitle("week")}
          </Text>
          <Text className="mt-0.5 text-[13px] text-t3">
            {formatDate(from)} – {formatDate(to)}
          </Text>

          {preview.isLoading ? (
            <ActivityIndicator color="#EAB54C" className="mt-6" />
          ) : preview.isError ? (
            <Text className="mt-5 text-sm leading-5 text-error">
              {userErrorMessage(preview.error, PUBLISH_PREVIEW_ERROR)}
            </Text>
          ) : !ready ? (
            <Text className="mt-5 text-sm leading-5 text-t2">{PUBLISH_EMPTY}</Text>
          ) : (
            <>
              <View className="mt-5 flex-row items-baseline gap-2">
                <Text className="font-serif text-4xl text-t1">{data.shifts}</Text>
                <Text className="text-sm text-t2">
                  {draftsCountLabel(data.shifts)}
                </Text>
              </View>

              {data.people > 0 ? (
                <View className="mt-5 flex-row items-center gap-3 rounded-2xl border border-border-2 bg-bg-2 px-4 py-3.5">
                  <View className="flex-1">
                    <Text className="text-[15px] font-sans-semibold text-t1">
                      {notifyLabel(data.people)}
                    </Text>
                    <Text className="mt-0.5 text-[13px] text-t3">
                      {notify ? NOTIFY_HINT : SILENT_HINT}
                    </Text>
                  </View>
                  <Switch
                    value={notify}
                    onValueChange={setNotify}
                    disabled={pending}
                    trackColor={{ false: "#2a241b", true: "#eab54c" }}
                    thumbColor="#f8f4ed"
                    ios_backgroundColor="#2a241b"
                  />
                </View>
              ) : (
                <Text className="mt-5 rounded-2xl border border-border-2 bg-bg-2 px-4 py-3.5 text-[13px] text-t3">
                  {nobodyToNotifyText(data)}
                </Text>
              )}

              {note ? (
                <Text className="mt-3 text-[12px] leading-5 text-t4">{note}</Text>
              ) : null}
            </>
          )}

          <View className="mt-6 gap-2.5">
            {ready ? (
              <GoldButton
                label={pending ? "Attendere…" : publishCta(data.shifts)}
                disabled={pending}
                onPress={submit}
              />
            ) : null}
            <Pressable
              onPress={onClose}
              disabled={pending}
              accessibilityRole="button"
              className="items-center py-2"
            >
              <Text className="text-sm text-t3">{ready ? "Annulla" : "Chiudi"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
