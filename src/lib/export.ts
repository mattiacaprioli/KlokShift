// Export ore/presenze — lato nativo (Print + Sharing + FileSystem).
// I costruttori dei documenti stanno in `exportBuilders.ts` (puri, senza Expo)
// perché sono condivisi con la dashboard web.

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";
import {
  absencesFileName,
  buildAbsencesCsv,
  buildHoursCsv,
  buildHoursHtml,
  hoursFileName,
} from "@/lib/exportBuilders";

export { buildHoursCsv, buildHoursHtml } from "@/lib/exportBuilders";

/** Genera un PDF del riepilogo ore e apre il foglio di condivisione. */
export async function exportHoursPdf(
  companyName: string,
  periodLabel: string,
  people: PersonHours[],
  totalHours: number,
  absences: AbsenceSummaryRow[] = [],
  selection: readonly string[] = []
): Promise<void> {
  const html = buildHoursHtml(
    companyName,
    periodLabel,
    people,
    totalHours,
    absences,
    selection
  );
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "com.adobe.pdf",
      mimeType: "application/pdf",
      dialogTitle: `Ore ${companyName} · ${periodLabel}`,
    });
  }
}

/** Genera un CSV del riepilogo ore e apre il foglio di condivisione. */
export async function exportHoursCsv(
  companyName: string,
  periodLabel: string,
  people: PersonHours[],
  absences: AbsenceSummaryRow[] = [],
  selection: readonly string[] = []
): Promise<void> {
  const csv = buildHoursCsv(people, absences);
  const uri = `${FileSystem.cacheDirectory}${hoursFileName(companyName, periodLabel, "csv", selection)}`;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "public.comma-separated-values-text",
      mimeType: "text/csv",
      dialogTitle: `Ore ${companyName} · ${periodLabel}`,
    });
  }
}

/** Genera il CSV delle assenze del periodo (file separato) e lo condivide. */
export async function exportAbsencesCsv(
  companyName: string,
  periodLabel: string,
  rows: AbsenceSummaryRow[],
  selection: readonly string[] = []
): Promise<void> {
  const csv = buildAbsencesCsv(rows);
  const uri = `${FileSystem.cacheDirectory}${absencesFileName(companyName, periodLabel, "csv", selection)}`;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "public.comma-separated-values-text",
      mimeType: "text/csv",
      dialogTitle: `Assenze ${companyName} · ${periodLabel}`,
    });
  }
}
