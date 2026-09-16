import { useLocalSearchParams, useRouter } from "expo-router";
import { ABSENCE_MANAGER_TUTORIAL } from "@/features/absences/tutorialContent";
import { COLLABORATOR_TUTORIAL } from "@/features/team/tutorialContent";
import { TutorialView } from "@/features/tutorial/TutorialView";

/**
 * I tutorial del titolare. `id` sceglie la guida: `collaboratori` (il default,
 * per i link già esistenti) o `assenze`.
 *
 * I testi stanno in `features/team/tutorialContent.ts` e
 * `features/absences/tutorialContent.ts`, condivisi con la dashboard web: questa
 * schermata li impagina e basta. Chi cambia una feature aggiorna quei file, non
 * questo.
 */
export default function TutorialScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();

  if (id === "assenze") {
    return (
      <TutorialView
        tutorial={ABSENCE_MANAGER_TUTORIAL}
        cta={{
          label: "Vai allo staff",
          onPress: () => router.push("/(manager)/(tabs)/staff"),
        }}
      />
    );
  }

  return (
    <TutorialView
      tutorial={COLLABORATOR_TUTORIAL}
      cta={{
        label: "Vai ai collaboratori",
        onPress: () => router.push("/(manager)/team"),
      }}
    />
  );
}
