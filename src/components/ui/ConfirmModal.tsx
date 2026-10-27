import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { GoldButton } from "./GoldButton";

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red, filled confirm button for irreversible actions. */
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Un campo in più sotto il messaggio (es. un motivo facoltativo). */
  children?: ReactNode;
};

/** App-styled confirmation dialog (replaces the native Alert for coherence). */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = "Conferma",
  cancelLabel = "Annulla",
  destructive,
  pending,
  onConfirm,
  onCancel,
  children,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {/* Con un campo di testo la tastiera coprirebbe i pulsanti. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable
          onPress={pending ? undefined : onCancel}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }}
          className="items-center justify-center px-8"
        >
          {/* Blocca la propagazione del tap sulla card */}
          <Pressable
            onPress={() => {}}
            className="w-full rounded-3xl border border-border-2 bg-bg-card p-6"
          >
            <Text className="text-lg font-sans-bold text-t1">{title}</Text>
            {message ? (
              <Text className="mt-2 text-sm leading-5 text-t2">{message}</Text>
            ) : null}
            {children ? <View className="mt-4">{children}</View> : null}

            <View className="mt-6 gap-2.5">
              {destructive ? (
                <Pressable
                  onPress={onConfirm}
                  disabled={pending}
                  className="items-center rounded-xl bg-error py-3.5"
                >
                  <Text
                    className="text-sm font-sans-bold"
                    style={{ color: "#FFFFFF" }}
                  >
                    {pending ? "Attendere…" : confirmLabel}
                  </Text>
                </Pressable>
              ) : (
                <GoldButton
                  label={pending ? "Attendere…" : confirmLabel}
                  disabled={pending}
                  onPress={onConfirm}
                />
              )}
              <Pressable
                onPress={onCancel}
                disabled={pending}
                className="items-center rounded-xl border border-border py-3.5"
              >
                <Text className="text-sm font-sans-semibold text-t2">
                  {cancelLabel}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
