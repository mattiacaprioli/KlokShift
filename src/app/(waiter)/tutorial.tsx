import { useRouter } from "expo-router";
import { ABSENCE_WAITER_TUTORIAL } from "@/features/absences/tutorialContent";
import { TutorialView } from "@/features/tutorial/TutorialView";

/**
 * Il tutorial del professionista: ferie, permessi e malattia. Il testo sta in
 * `features/absences/tutorialContent.ts`.
 */
export default function WaiterTutorialScreen() {
  const router = useRouter();
  return (
    <TutorialView
      tutorial={ABSENCE_WAITER_TUTORIAL}
      cta={{
        label: "Vai alle tue assenze",
        onPress: () => router.push("/(waiter)/assenze"),
      }}
    />
  );
}
