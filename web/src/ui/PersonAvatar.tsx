import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getWorkspaceAvatars } from "@/features/staff/api";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { useAuth } from "@/lib/auth";
import { qk } from "@/lib/queryKeys";
import { reportError } from "../lib/reportError";
import { Avatar } from "./Avatar";

type Photo = { userId: string | null; url: string | null };
const Photos = createContext(new Map<string, Photo>());

/** Una lettura condivisa per tutta la dashboard, senza una richiesta per persona. */
export function PersonAvatarProvider({ children }: { children: ReactNode }) {
  const { workspaceId, venuesKey } = useOwnerVenues();
  const { data, error } = useQuery({
    queryKey: qk.staff.avatars(workspaceId ?? "", venuesKey),
    queryFn: () => getWorkspaceAvatars(workspaceId!),
    enabled: !!workspaceId,
  });
  useEffect(() => {
    if (error) reportError(error, "foto organico");
  }, [error]);
  const photos = useMemo(() => {
    const people = new Map<string, Photo>();
    for (const person of data ?? []) {
      const photo = {
        userId: person.user_id,
        url: person.waiter?.avatar_url ?? null,
      };
      people.set(person.id, photo);
    }
    return people;
  }, [data]);
  return <Photos.Provider value={photos}>{children}</Photos.Provider>;
}

/** L'id è della persona nell'azienda; il nome resta quello della sua scheda. */
export function PersonAvatar({
  personId,
  name,
  size = 32,
  className,
}: {
  personId?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const photos = useContext(Photos);
  const { profile } = useAuth();
  const photo = personId ? photos.get(personId) : undefined;
  // Una foto appena cambiata nelle impostazioni si riflette subito anche qui.
  const url =
    photo?.userId === profile?.id && profile
      ? profile.avatar_url
      : photo?.url;
  return <Avatar url={url} name={name} size={size} className={className} />;
}
