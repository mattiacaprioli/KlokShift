// Export ore/presenze — lato nativo (Print + Sharing + FileSystem).
// I costruttori dei documenti stanno in `exportBuilders.ts` (puri, senza Expo)
// perché sono condivisi con la dashboard web.

import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import {
  buildHoursCsv,
  buildHoursHtml,
  hoursFileName,
} from "@/lib/exportBuilders";

export { buildHoursCsv, buildHoursHtml } from "@/lib/exportBuilders";

/** Genera un PDF del riepilogo ore e apre il foglio di condivisione. */
export async function exportHoursPdf(
  companyName: string,
  monthLabel: string,
  people: PersonHours[],
  totalHours: number
): Promise<void> {
  const html = buildHoursHtml(companyName, monthLabel, people, totalHours);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "com.adobe.pdf",
      mimeType: "application/pdf",
      dialogTitle: `Ore ${companyName} · ${monthLabel}`,
    });
  }
}

/** Genera un CSV del riepilogo ore e apre il foglio di condivisione. */
export async function exportHoursCsv(
  companyName: string,
  monthLabel: string,
  people: PersonHours[]
): Promise<void> {
  const csv = buildHoursCsv(people);
  const uri = `${FileSystem.cacheDirectory}${hoursFileName(companyName, monthLabel, "csv")}`;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      UTI: "public.comma-separated-values-text",
      mimeType: "text/csv",
      dialogTitle: `Ore ${companyName} · ${monthLabel}`,
    });
  }
}
