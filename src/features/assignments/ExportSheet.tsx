import { ActivityIndicator } from "react-native";
import { Pressable, Text, View } from "@/tw";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GhostButton } from "@/components/ui/GhostButton";
import { GoldButton } from "@/components/ui/GoldButton";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import {
  EXPORT_BUTTON_LABEL,
  EXPORT_FORMATS,
  EXPORT_ISSUES_TITLE,
  unavailableNote,
  type ExportFormat,
  type ExportIssueTarget,
  type ExportPreview,
} from "./exportPreview";

/*
 * «Esporta per il consulente» nell'app (spec 2026-11-15-anteprima-export-design.md):
 * il pannello che sale dal basso con la scelta del file, i totali e cosa resta
 * fuori o va controllato. Le righe del file qui non ci stanno: le mostra la
 * dashboard (`web/src/hours/ExportDialog.tsx`, gemello di questo), come la prima
 * pagina di riepilogo dell'anteprima di Planday. Presentazionale: dati e scarico
 * li gestisce la pagina Ore.
 */

const ISSUE_LINK: Record<ExportIssueTarget, string> = {
  to_fix: "Ore da sistemare",
  codes: "Codici",
  absences: "Assenze",
  team: "Team",
};

export function ExportSheet({
  visible,
  subtitle,
  format,
  onFormat,
  state,
  preview,
  busy,
  error,
  onRetry,
  onDownload,
  onIssue,
  onClose,
}: {
  visible: boolean;
  subtitle: string;
  format: ExportFormat;
  onFormat: (f: ExportFormat) => void;
  state: "loading" | "error" | "ready";
  /** Un'anteprima per formato: serve a spegnere quelli non disponibili. */
  preview: Record<ExportFormat, ExportPreview> | null;
  busy: boolean;
  /** L'errore dello scarico, detto qui: un toast resterebbe sotto il `Modal`. */
  error?: string | null;
  onRetry: () => void;
  onDownload: () => void;
  onIssue: (t: ExportIssueTarget) => void;
  onClose: () => void;
}) {
  const current = preview?.[format] ?? null;
  const note = preview ? unavailableNote(preview) : null;

  return (
    <BottomSheet visible={visible} onClose={onClose} dismissable={!busy}>
      <Text className="font-serif text-[22px] text-t1">{EXPORT_BUTTON_LABEL}</Text>
      <Text className="mt-1 text-[13px] text-t3">{subtitle}</Text>

      <View className="mt-4 flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {EXPORT_FORMATS.map((f) => {
          const on = f.key === format;
          const off = preview ? !preview[f.key].available : false;
          return (
            <Pressable
              key={f.key}
              onPress={() => onFormat(f.key)}
              disabled={off || busy}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: off || busy }}
              className={cn(
                "rounded-xl border px-3 py-2",
                on ? "border-gold" : "border-border-2",
                (off || busy) && "opacity-40"
              )}
              style={on ? { backgroundColor: "rgba(234,181,76,0.12)" } : undefined}
            >
              <Text className={cn("text-[13px]", on ? "text-t1" : "text-t2")}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {note ? <Text className="mt-2 text-[12px] leading-4 text-t3">{note}</Text> : null}

      <View className="mt-4 gap-3">
        {state === "loading" ? (
          <View className="items-center py-6">
            <ActivityIndicator color="#EAB54C" />
          </View>
        ) : null}
        {state === "error" ? (
          <View className="gap-3 rounded-2xl border border-error px-4 py-3" style={{ backgroundColor: "rgba(229,91,69,0.08)" }}>
            <Text className="text-[13px] text-t2">Export non riuscito. Riprova.</Text>
            <GhostButton label="Riprova" onPress={onRetry} />
          </View>
        ) : null}
        {state === "ready" && current ? (
          <>
            {current.totals.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {current.totals.map((t) => (
                  <View key={t.label} className="min-w-[46%] flex-1 rounded-2xl border border-border-2 bg-bg-0 px-3 py-2">
                    <Text className="text-[11px] text-t3">{t.label}</Text>
                    <Text className="mt-0.5 text-[17px] font-sans-semibold text-t1">{t.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {current.issues.length > 0 ? (
              <View
                className="gap-2 rounded-2xl border border-warning px-4 py-3"
                // Sfondo inline come nelle `Pill`: `bg-warning/10` passerebbe da
                // `color-mix`, che react-native-css non regge.
                style={{ backgroundColor: "rgba(226,146,47,0.08)" }}
              >
                <View className="flex-row items-center gap-2">
                  <Icon name="alert" size={15} color="#E2922F" />
                  <Text className="text-[13px] font-sans-semibold text-warning">{EXPORT_ISSUES_TITLE}</Text>
                </View>
                {current.issues.map((issue) => (
                  <View key={issue.target} className="flex-row items-start justify-between gap-3">
                    <Text className="flex-1 text-[13px] leading-5 text-t2">{issue.text}</Text>
                    <Pressable onPress={() => onIssue(issue.target)} accessibilityRole="link" hitSlop={8}>
                      <Text className="text-[13px] font-sans-semibold text-gold">{ISSUE_LINK[issue.target]}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}

        {error ? <Text className="text-[13px] text-error">{error}</Text> : null}
        <GoldButton
          label="Scarica e condividi"
          onPress={onDownload}
          disabled={busy || state !== "ready" || !current?.available}
        />
      </View>
    </BottomSheet>
  );
}
