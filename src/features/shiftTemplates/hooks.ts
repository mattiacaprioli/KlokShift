import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import {
  deleteShiftTemplate,
  getVenueShiftTemplates,
  saveShiftTemplate,
} from "./api";
import type { ShiftTemplateInput } from "./template";

export function useVenueShiftTemplates(venueId: string | null | undefined) {
  return useQuery({
    queryKey: qk.shiftTemplates.byVenue(venueId ?? ""),
    queryFn: () => getVenueShiftTemplates(venueId as string),
    enabled: !!venueId,
  });
}

export function useSaveShiftTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { venueId: string; input: ShiftTemplateInput }) =>
      saveShiftTemplate(vars.venueId, vars.input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.shiftTemplates.all }),
  });
}

export function useDeleteShiftTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => deleteShiftTemplate(templateId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: qk.shiftTemplates.all }),
  });
}
