import AthleteApp from "../../../ui/AthleteApp";
import AthleteAiWorkout from "../../../ui/athlete-ai-workout";
import AthleteAiWorkoutShortcut from "../../../ui/athlete-ai-workout-shortcut";
import AthletePerformance from "../../../ui/athlete-performance";
import AthleteHomePrimaryActions from "../../../ui/athlete-home-primary-actions";

export default async function AthletePage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  if (slug[0] === "ai-workout") return <AthleteAiWorkout />;
  if (slug[0] === "performance") return <AthletePerformance />;

  if (slug[0] === "home") {
    return <div style={{ position: "relative", width: "min(100%, 430px)", minHeight: "100dvh", margin: "0 auto" }}>
      <AthleteApp />
      <AthleteHomePrimaryActions />
    </div>;
  }

  return <>
    <AthleteApp />
    <AthleteAiWorkoutShortcut />
  </>;
}
