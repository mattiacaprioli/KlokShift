import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";
import { getAdminAccess } from "./api";
const fresh = { staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true } as const;
export function useAdminAccess(userId: string, sessionVersion: string) {
  return useQuery({ ...fresh, queryKey: qk.admin.access(userId, sessionVersion), queryFn: getAdminAccess, refetchInterval: 60000 });
}
export function useAdminRead<T>(userId: string, resource: string, parameters: unknown, queryFn: () => Promise<T>) {
  const client = useQueryClient();
  const query = useQuery({ ...fresh, queryKey: qk.admin.data(userId, resource, parameters), queryFn });
  useEffect(() => {
    if (query.error instanceof Error && /admin_not_allowed|admin_mfa_required|not_authenticated/.test(query.error.message)) {
      void client.cancelQueries({ queryKey: qk.admin.privileged }).then(() => client.removeQueries({ queryKey: qk.admin.privileged }));
      void client.invalidateQueries({ queryKey: ["admin", "access"] });
    }
  }, [client, query.error]);
  return query;
}
