"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

const PUBLIC_SEGMENTS = new Set(["welcome", "access", "login", "onboarding"]);

export default function AthleteAiWorkoutShortcut() {
  const pathname = usePathname();
  const router = useRouter();
  if (!pathname.startsWith("/pt/athlete/")) return null;
  const segment = pathname.split("/pt/athlete/")[1]?.split("/")[0] ?? "";
  if (!segment || segment === "ai-workout" || PUBLIC_SEGMENTS.has(segment)) return null;

  return <button
    type="button"
    aria-label="Criar treino personalizado com IA"
    onClick={() => router.push("/pt/athlete/ai-workout")}
    style={{
      position: "fixed",
      right: 16,
      bottom: 82,
      zIndex: 80,
      display: "flex",
      alignItems: "center",
      gap: 7,
      border: "1px solid rgba(255,255,255,.5)",
      borderRadius: 999,
      background: "linear-gradient(135deg,#0d4969,#087f85)",
      boxShadow: "0 12px 28px rgba(7,65,87,.25)",
      color: "white",
      padding: "11px 14px",
      fontSize: 12,
      fontWeight: 800,
      cursor: "pointer",
    }}
  ><Sparkles size={16} />Criar treino com IA</button>;
}
