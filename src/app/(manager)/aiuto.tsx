import { useRouter } from "expo-router";
import { useOwnerVenues } from "@/features/venues/OwnerVenues";
import { SupportView, type SupportGuide } from "@/features/support/SupportView";

/**
 * «Aiuto e supporto» di chi gestisce. Una guida compare solo a chi può fare
 * quello che spiega: i collaboratori sono del titolare, le assenze di chi
 * gestisce l'organico. Domande e contatto li vedono tutti.
 */
export default function ManagerSupportScreen() {
  const router = useRouter();
  const { isOwner, canAny, workspaceId, workspaceName } = useOwnerVenues();

  const guides: SupportGuide[] = [];
  if (isOwner) {
    guides.push({
      icon: "users",
      title: "Aggiungere un collaboratore",
      subtitle: "Invito, permessi e cosa succede dopo",
      onPress: () => router.push("/(manager)/tutorial"),
    });
  }
  if (canAny("can_manage_staff")) {
    guides.push({
      icon: "calendar",
      title: "Ferie, permessi e malattia",
      subtitle: "Richieste, turni in conflitto ed export",
      onPress: () =>
        router.push({ pathname: "/(manager)/tutorial", params: { id: "assenze" } }),
    });
  }

  return (
    <SupportView
      audience="manager"
      guides={guides}
      workspace={workspaceId ? { id: workspaceId, name: workspaceName } : null}
    />
  );
}
