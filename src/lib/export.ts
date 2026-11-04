// Export ore/presenze — lato nativo (Print + Sharing + FileSystem).
// I costruttori dei documenti stanno in `exportBuilders.ts` (puri, senza Expo)
// perché sono condivisi con la dashboard web.

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";
import type { ExportCodes } from "@/features/assignments/exportCodes";
import type { HoursDailyRow } from "@/features/assignments/hoursDaily";
import {
  absencesFileName,
  buildAbsencesCsv,
  buildDailyCsv,
  dailyFileName,
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
  selection: readonly string[] = [],
  timesheet?: { rows: HoursDailyRow[]; start: string; end: string }
): Promise<void> {
  const html = buildHoursHtml(
    companyName,
    periodLabel,
    people,
    totalHours,
    absences,
    selection,
    timesheet
  );
  // A4 orizzontale in punti: expo-print ignora @page e parte da Letter verticale.
  const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 });
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
  selection: readonly string[] = [],
  codes?: ExportCodes
): Promise<void> {
  const csv = buildHoursCsv(people, absences, codes);
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
  selection: readonly string[] = [],
  codes?: ExportCodes
): Promise<void> {
  const csv = buildAbsencesCsv(rows, codes);
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

/** Genera il CSV giornaliero (una riga per persona, giorno e voce) e lo condivide. */
export async function exportDailyCsv(
  companyName: string,
  periodLabel: string,
  rows: HoursDailyRow[],
  selection: readonly string[] = [],
  codes?: ExportCodes
): Promise<void> {
  const csv = buildDailyCsv(rows, codes);
  const uri = `${FileSystem.cacheDirectory}${dailyFileName(companyName, periodLabel, "csv", selection)}`;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "public.comma-separated-values-text",
      mimeType: "text/csv",
      dialogTitle: `Ore giornaliere ${companyName} · ${periodLabel}`,
    });
  }
}
