import AthleteApp from "../../../ui/AthleteApp";
import AthleteAiWorkout from "../../../ui/athlete-ai-workout";
import AthleteAiWorkoutShortcut from "../../../ui/athlete-ai-workout-shortcut";
import AthletePerformance from "../../../ui/athlete-performance";

export default async function AthletePage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  if (slug[0] === "ai-workout") return <AthleteAiWorkout />;
  if (slug[0] === "performance") return <AthletePerformance />;

  return <>
    <AthleteApp />
    <AthleteAiWorkoutShortcut />
  </>;
}
