import { ActivityIndicator, Modal } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { usePublishPreview, usePublishShifts } from "@/features/assignments/hooks";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/providers/Toast";
import {
  PUBLISH_EMPTY,
  PUBLISH,
  PUBLISH_ERROR,
  PUBLISH_NOTIFY,
  PUBLISH_PREVIEW_ERROR,
  PUBLISH_SILENT,
  PUBLISH_TITLE,
  publishPreviewLines,
  publishedToast,
  shouldOfferNotifyChoice,
} from "./drafts";

/**
 * «Pubblica» per un periodo: carica l'anteprima (cosa si pubblica e chi viene
 * avvisato) e pubblica **esattamente i turni dell'anteprima**, non quelli che
 * nel frattempo fossero comparsi. Due strade: con gli avvisi, o in silenzio.
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
  const data = preview.data;
  const nothing = !!data && data.shift_ids.length === 0;

  function submit(notify: boolean) {
    if (!data || data.shift_ids.length === 0) return;
    publish.mutate(
      { shiftIds: data.shift_ids, notify },
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
      onRequestClose={onClose}
    >
      <Pressable
        onPress={publish.isPending ? undefined : onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.66)" }}
        className="items-center justify-center px-5"
      >
        <Pressable
          onPress={() => {}}
          className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
        >
          <Text className="text-lg font-sans-bold text-t1">{PUBLISH_TITLE}</Text>

          {preview.isLoading ? (
            <ActivityIndicator color="#EAB54C" className="mt-6" />
          ) : preview.isError ? (
            <Text className="mt-4 text-sm leading-5 text-error">
              {userErrorMessage(preview.error, PUBLISH_PREVIEW_ERROR)}
            </Text>
          ) : nothing ? (
            <Text className="mt-4 text-sm leading-5 text-t2">{PUBLISH_EMPTY}</Text>
          ) : data ? (
            <View className="mt-4 gap-1.5">
              {publishPreviewLines(data).map((line) => (
                <Text key={line} className="text-sm leading-5 text-t2">
                  {line}
                </Text>
              ))}
            </View>
          ) : null}

          <View className="mt-6 gap-2.5">
            {data && !nothing ? (
              <>
                {shouldOfferNotifyChoice(data) ? (
                  <>
                    <GoldButton
                      label={publish.isPending ? "Attendere…" : PUBLISH_NOTIFY}
                      disabled={publish.isPending}
                      onPress={() => submit(true)}
                    />
                    <Pressable
                      onPress={() => submit(false)}
                      disabled={publish.isPending}
                      accessibilityRole="button"
                      className="items-center rounded-xl border border-border py-3.5"
                      style={publish.isPending ? { opacity: 0.5 } : undefined}
                    >
                      <Text className="text-sm font-sans-semibold text-t1">
                        {PUBLISH_SILENT}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <GoldButton
                    label={publish.isPending ? "Attendere…" : PUBLISH}
                    disabled={publish.isPending}
                    onPress={() => submit(false)}
                  />
                )}
              </>
            ) : null}
            <Pressable
              onPress={onClose}
              disabled={publish.isPending}
              className="items-center py-2"
            >
              <Text className="text-sm text-t3">
                {data && !nothing ? "Annulla" : "Chiudi"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
