import { supabase } from "@/lib/supabase";
import type { PendingLegal } from "./gate";
import { LEGAL_VERSION } from "./version";

/** Le aziende che chi gestisce deve ancora accettare (o aspettare che il titolare accetti). */
export async function getPendingLegalAcceptances(): Promise<PendingLegal[]> {
  const { data, error } = await supabase.rpc("get_pending_legal_acceptances");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    workspaceId: r.workspace_id,
    workspaceName: r.workspace_name,
    canAccept: r.can_accept,
  }));
}

/** Il titolare accetta termini e DPA per conto dell'azienda, nella versione in vigore. */
export async function acceptLegalTerms(workspaceId: string): Promise<void> {
  const { error } = await supabase.rpc("accept_legal_terms", {
    p_workspace: workspaceId,
    p_version: LEGAL_VERSION,
  });
  if (error) throw new Error(error.message);
}
