"use client";

import { usePathname, useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";

export default function CoachAthleteAiShortcut() {
  const pathname = usePathname();
  const router = useRouter();
  if (!pathname.startsWith("/pt/coach") || pathname.includes("/ai-requests")) return null;

  return <button
    type="button"
    aria-label="Abrir solicitações de treino com IA dos atletas"
    onClick={() => router.push("/pt/coach/ai-requests")}
    style={{
      position: "fixed",
      right: 18,
      bottom: 18,
      zIndex: 90,
      display: "flex",
      alignItems: "center",
      gap: 7,
      border: "1px solid rgba(255,255,255,.55)",
      borderRadius: 999,
      background: "linear-gradient(135deg,#123f57,#087c70)",
      boxShadow: "0 12px 30px rgba(18,63,87,.24)",
      color: "white",
      padding: "11px 14px",
      fontSize: 12,
      fontWeight: 800,
      cursor: "pointer",
    }}
  ><ClipboardCheck size={16} />Treinos IA dos atletas</button>;
}
