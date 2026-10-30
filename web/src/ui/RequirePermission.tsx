import type { ReactNode } from "react";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import {
  missingPermission,
  type TeamPermission,
} from "@/features/workspace/permissions";
import { PageHeader, Placeholder } from "./primitives";

/**
 * Una pagina che serve un permesso: chi non ce l'ha (un collaboratore arrivato
 * da un link o da un segnalibro) legge quale manca e a chi chiederlo, invece di
 * una pagina vuota. Basta uno dei permessi elencati. Solo UX: le righe le
 * filtrano comunque RLS e RPC.
 */
export function RequirePermission({
  title,
  perms,
  children,
}: {
  title: string;
  perms: [TeamPermission, ...TeamPermission[]];
  children: ReactNode;
}) {
  const { canAny } = useOwnerVenues();
  if (perms.some((perm) => canAny(perm))) return children;
  const { title: why, detail } = missingPermission(perms[0]);
  return (
    <>
      <PageHeader title={title} />
      <Placeholder title={why} detail={detail} />
    </>
  );
}
