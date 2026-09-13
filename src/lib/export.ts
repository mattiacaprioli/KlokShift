// Export ore/presenze — lato nativo (Print + Sharing + FileSystem).
// I costruttori dei documenti stanno in `exportBuilders.ts` (puri, senza Expo)
// perché sono condivisi con la dashboard web.

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { StaffHoursRow } from "@/features/assignments/api";
import {
  buildHoursCsv,
  buildHoursHtml,
  hoursFileName,
} from "@/lib/exportBuilders";

export { buildHoursCsv, buildHoursHtml } from "@/lib/exportBuilders";

/** Genera un PDF del riepilogo ore e apre il foglio di condivisione. */
export async function exportHoursPdf(
  venueName: string,
  monthLabel: string,
  rows: StaffHoursRow[],
  totalHours: number
): Promise<void> {
  const html = buildHoursHtml(venueName, monthLabel, rows, totalHours);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "com.adobe.pdf",
      mimeType: "application/pdf",
      dialogTitle: `Ore ${venueName} · ${monthLabel}`,
    });
  }
}

/** Genera un CSV del riepilogo ore e apre il foglio di condivisione. */
export async function exportHoursCsv(
  venueName: string,
  monthLabel: string,
  rows: StaffHoursRow[]
): Promise<void> {
  const csv = buildHoursCsv(rows);
  const uri = `${FileSystem.cacheDirectory}${hoursFileName(venueName, monthLabel, "csv")}`;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "public.comma-separated-values-text",
      mimeType: "text/csv",
      dialogTitle: `Ore ${venueName} · ${monthLabel}`,
    });
  }
}
