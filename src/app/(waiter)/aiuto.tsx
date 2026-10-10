import { useRouter } from "expo-router";
import { SupportView } from "@/features/support/SupportView";

/** «Aiuto e supporto» del professionista: la vista è condivisa col gestore. */
export default function WaiterSupportScreen() {
  const router = useRouter();
  return (
    <SupportView
      audience="waiter"
      guides={[
        {
          icon: "calendar",
          title: "Ferie, permessi e malattia",
          subtitle: "Come chiederli e cosa succede dopo",
          onPress: () => router.push("/(waiter)/tutorial"),
        },
      ]}
    />
  );
}
