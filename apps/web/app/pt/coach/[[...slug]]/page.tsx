import Dashboard from "../../../ui/Dashboard";
import CoachAthleteAiRequests from "../../../ui/coach-athlete-ai-requests";
import CoachAthleteAiShortcut from "../../../ui/coach-athlete-ai-shortcut";

export default async function CoachPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  if (slug[0] === "ai-requests") return <CoachAthleteAiRequests />;

  return <>
    <Dashboard />
    <CoachAthleteAiShortcut />
  </>;
}
