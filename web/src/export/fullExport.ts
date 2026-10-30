import { strToU8, zipSync, type Zippable } from "fflate";
import { supabase } from "@/lib/supabase";
import { UserFacingError } from "@/lib/errors";
import { documentPaths, fullExportFileName, fullExportFiles, fullExportSchema } from "./fullExportFiles";

/*
 * Export completo dalla dashboard (solo web): dati dal server, file dei documenti
 * dallo Storage con le policy di chi scarica, pacchetto ZIP composto qui.
 */

const DOCUMENTS_BUCKET = "staff-documents";

export async function downloadFullExport(workspaceId: string, onProgress?: (message: string) => void): Promise<void> {
  onProgress?.("Raccolta dei dati…");
  const { data, error } = await supabase.rpc("export_workspace_data", { p_workspace: workspaceId });
  if (error) {
    if (/export_not_allowed/.test(error.message)) {
      throw new UserFacingError("L’export completo è per chi gestisce l’azienda: titolare, oppure collaboratore con «Team» e «Ore» su tutte le sedi.");
    }
    if (/workspace_not_readable/.test(error.message)) {
      throw new UserFacingError("Il periodo di consultazione di questa azienda è terminato: i dati non sono più disponibili.");
    }
    throw new Error(error.message);
  }
  const parsed = fullExportSchema.safeParse(data);
  if (!parsed.success) throw new UserFacingError("I dati dell’export non sono leggibili. Riprova fra qualche minuto.");
  const exportData = parsed.data;

  const zip: Zippable = {};
  const missing: string[] = [];
  const docs = exportData.documents ?? [];
  const paths = documentPaths(docs);
  for (const [i, doc] of docs.entries()) {
    onProgress?.(`Documenti: ${i + 1} di ${docs.length}…`);
    const file = await supabase.storage.from(DOCUMENTS_BUCKET).download(doc.storage_path);
    if (file.error || !file.data) { missing.push(doc.storage_path); continue; }
    // I documenti sono già compressi (PDF, immagini): si salvano senza ricomprimerli.
    zip[paths[i]] = [new Uint8Array(await file.data.arrayBuffer()), { level: 0 }];
  }
  for (const [name, content] of Object.entries(fullExportFiles(exportData, missing))) zip[name] = strToU8(content);

  onProgress?.("Creazione del pacchetto…");
  // Copia su un ArrayBuffer semplice: è il tipo che Blob accetta.
  const blob = new Blob([new Uint8Array(zipSync(zip, { level: 6 }))], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fullExportFileName(exportData.workspace.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
