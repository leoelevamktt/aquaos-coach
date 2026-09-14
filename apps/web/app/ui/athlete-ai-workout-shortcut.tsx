"use client";

import { usePathname, useRouter } from "next/navigation";
import { Sparkles, TrendingUp } from "lucide-react";

const PUBLIC_SEGMENTS = new Set(["welcome", "access", "login", "onboarding"]);

export default function AthleteAiWorkoutShortcut() {
  const pathname = usePathname();
  const router = useRouter();
  if (!pathname.startsWith("/pt/athlete/")) return null;
  const segment = pathname.split("/pt/athlete/")[1]?.split("/")[0] ?? "";
  if (!segment || segment === "ai-workout" || segment === "performance" || PUBLIC_SEGMENTS.has(segment)) return null;

  if (segment === "home") {
    return <div
      aria-label="Ações rápidas do atleta"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: 78,
        zIndex: 120,
        width: "calc(100% - 28px)",
        maxWidth: 508,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        padding: 8,
        border: "1px solid rgba(15,55,85,.12)",
        borderRadius: 18,
        background: "rgba(255,255,255,.97)",
        boxShadow: "0 14px 34px rgba(7,42,68,.20)",
        backdropFilter: "blur(12px)",
      }}
    >
      <button
        type="button"
        onClick={() => router.push("/pt/athlete/ai-workout")}
        style={{
          minHeight: 54,
          border: 0,
          borderRadius: 13,
          background: "#ffd200",
          color: "#071d3d",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          padding: "10px 9px",
          fontSize: 12,
          fontWeight: 900,
          cursor: "pointer",
        }}
      ><Sparkles size={17} />Criar treino com IA</button>
      <button
        type="button"
        onClick={() => router.push("/pt/athlete/performance")}
        style={{
          minHeight: 54,
          border: "1px solid #0c315f",
          borderRadius: 13,
          background: "white",
          color: "#0c315f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          padding: "10px 9px",
          fontSize: 12,
          fontWeight: 900,
          cursor: "pointer",
        }}
      ><TrendingUp size={17} />Acompanhar resultados</button>
    </div>;
  }

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
