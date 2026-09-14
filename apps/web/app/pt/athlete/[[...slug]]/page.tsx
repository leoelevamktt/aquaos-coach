import AthleteApp from "../../../ui/AthleteApp";
import AthleteAiWorkout from "../../../ui/athlete-ai-workout";
import AthleteAiWorkoutShortcut from "../../../ui/athlete-ai-workout-shortcut";

export default async function AthletePage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  if (slug[0] === "ai-workout") return <AthleteAiWorkout />;

  return <>
    <AthleteApp />
    <AthleteAiWorkoutShortcut />
  </>;
}
