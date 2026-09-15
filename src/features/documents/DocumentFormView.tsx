import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, ScrollView, Text, View } from "@/tw";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/ui/Mono";
import { cn } from "@/lib/cn";
import { userErrorMessage } from "@/lib/errors";
import { toDateString } from "@/lib/format";
import { useToast } from "@/providers/Toast";
import { PickerField } from "@/components/form/ControlledPicker";
import { pickDocument } from "./pickDocument";
import type { DocumentFile } from "./api";

type Props = {
  /** In modifica il file c'è già: si può sostituire, non è obbligatorio. */
  initialName?: string;
  initialExpiresAt?: string | null;
  requireFile?: boolean;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: {
    name: string;
    expires_at: string | null;
    file: DocumentFile | null;
  }) => void;
};

/**
 * Form di un documento: file, nome libero, scadenza facoltativa.
 *
 * Il nome è **testo libero** di proposito — l'HACCP è solo il caso più comune, e
 * un elenco chiuso lascerebbe fuori il patentino carrelli o il nulla osta che
 * qualche sede chiede davvero.
 */
export function DocumentFormView({
  initialName = "",
  initialExpiresAt = null,
  requireFile,
  submitLabel,
  pending,
  onSubmit,
}: Props) {
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [name, setName] = useState(initialName);
  const [file, setFile] = useState<DocumentFile | null>(null);
  const [picking, setPicking] = useState(false);
  const [hasExpiry, setHasExpiry] = useState(!!initialExpiresAt);
  const [expiry, setExpiry] = useState<Date>(
    initialExpiresAt ? new Date(`${initialExpiresAt}T00:00:00`) : new Date()
  );

  async function onPick() {
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (!picked) return;
      setFile(picked);
      // Il nome del file è un default onesto: chi carica "haccp-rossi.pdf" non
      // ha voglia di riscrivere "HACCP". Resta modificabile.
      if (!name.trim()) {
        setName(picked.fileName.replace(/\.[^.]+$/, ""));
      }
    } catch (e) {
      toast.show(
        userErrorMessage(e, "Selezione non riuscita."),
        "error"
      );
    } finally {
      setPicking(false);
    }
  }

  const canSubmit =
    !!name.trim() && !pending && (!requireFile || !!file);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 8,
          paddingBottom: insets.bottom + 32,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={onPick}
          disabled={picking}
          className={cn(
            "flex-row items-center gap-3 rounded-2xl border bg-bg-card p-4",
            file ? "border-gold" : "border-border-2"
          )}
        >
          <View className="h-11 w-11 items-center justify-center rounded-xl border border-border-2 bg-bg-1">
            <Icon
              name={file ? "check" : "upload"}
              size={20}
              color={file ? "#EAB54C" : "#8C857A"}
            />
          </View>
          <View className="flex-1">
            <Text className="font-sans-semibold text-[15px] text-t1">
              {file ? file.fileName : "Scegli il file"}
            </Text>
            <Text className="mt-0.5 font-sans text-[12.5px] text-t3">
              {picking
                ? "Apertura…"
                : requireFile
                  ? "PDF o immagine, max 10 MB"
                  : "Tocca per sostituire il file caricato"}
            </Text>
          </View>
          {picking ? <ActivityIndicator color="#EAB54C" /> : null}
        </Pressable>

        <Input
          label="Nome del documento"
          value={name}
          onChangeText={setName}
          placeholder="Es. Attestato HACCP"
        />

        <View className="gap-2">
          <Mono>Scadenza · facoltativa</Mono>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => setHasExpiry(false)}
              className={cn(
                "flex-1 items-center rounded-2xl border py-3",
                hasExpiry ? "border-border-2 bg-bg-2" : "border-gold bg-bg-card"
              )}
            >
              <Text
                className={cn(
                  "text-sm",
                  hasExpiry ? "text-t3" : "font-sans-semibold text-t1"
                )}
              >
                Non scade
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setHasExpiry(true)}
              className={cn(
                "flex-1 items-center rounded-2xl border py-3",
                hasExpiry ? "border-gold bg-bg-card" : "border-border-2 bg-bg-2"
              )}
            >
              <Text
                className={cn(
                  "text-sm",
                  hasExpiry ? "font-sans-semibold text-t1" : "text-t3"
                )}
              >
                Scade il…
              </Text>
            </Pressable>
          </View>
          {hasExpiry ? (
            <PickerField
              mode="date"
              value={expiry}
              onChange={setExpiry}
              label="Data di scadenza"
            />
          ) : null}
        </View>

        <GoldButton
          className="mt-1"
          label={pending ? "Salvataggio…" : submitLabel}
          disabled={!canSubmit}
          onPress={() =>
            onSubmit({
              name: name.trim(),
              expires_at: hasExpiry ? toDateString(expiry) : null,
              file,
            })
          }
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
