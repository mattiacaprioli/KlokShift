import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  createDocumentUrl,
  createStaffDocument,
  deleteStaffDocument,
  getStaffDocuments,
  replaceStaffDocumentFile,
  updateStaffDocument,
  type DocumentFile,
  type DocumentMeta,
  type StaffDocument,
} from "./api";

export function useStaffDocuments(memberId: string | undefined) {
  return useQuery({
    queryKey: qk.documents.byMember(memberId ?? ""),
    queryFn: () => getStaffDocuments(memberId as string),
    enabled: !!memberId,
  });
}

function useDocumentsInvalidation(memberId: string) {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: qk.documents.byMember(memberId) });
}

export function useCreateStaffDocument(memberId: string) {
  const invalidate = useDocumentsInvalidation(memberId);
  return useMutation({
    mutationFn: (vars: {
      meta: DocumentMeta;
      file: DocumentFile;
    }) => createStaffDocument(memberId, vars.meta, vars.file),
    onSuccess: invalidate,
  });
}

export function useUpdateStaffDocument(memberId: string) {
  const invalidate = useDocumentsInvalidation(memberId);
  return useMutation({
    mutationFn: (vars: { id: string; meta: DocumentMeta }) =>
      updateStaffDocument(vars.id, vars.meta),
    onSuccess: invalidate,
  });
}

export function useReplaceStaffDocumentFile(memberId: string) {
  const invalidate = useDocumentsInvalidation(memberId);
  return useMutation({
    mutationFn: (vars: { doc: StaffDocument; file: DocumentFile }) =>
      replaceStaffDocumentFile(vars.doc, vars.file),
    onSuccess: invalidate,
  });
}

export function useDeleteStaffDocument(memberId: string) {
  const invalidate = useDocumentsInvalidation(memberId);
  return useMutation({
    mutationFn: (doc: StaffDocument) => deleteStaffDocument(doc),
    onSuccess: invalidate,
  });
}

/**
 * Mutation e non query, di proposito: l'URL firmata dura 60 secondi e non deve
 * finire nella cache di TanStack, dove verrebbe riusata già scaduta. Si chiede
 * al tap, si usa, si butta.
 */
export function useDocumentUrl() {
  return useMutation({
    mutationFn: (vars: { storagePath: string; download?: string }) =>
      createDocumentUrl(vars.storagePath, { download: vars.download }),
  });
}
