import { Sparkles, TrendingUp } from "lucide-react";

export default function AthleteHomePrimaryActions() {
  return <aside
    aria-label="Ações principais do atleta"
    style={{
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 86,
      zIndex: 80,
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 8,
      padding: 8,
      border: "1px solid rgba(8,49,95,.14)",
      borderRadius: 18,
      background: "rgba(255,255,255,.985)",
      boxShadow: "0 16px 40px rgba(7,42,68,.24)",
      backdropFilter: "blur(12px)",
    }}
  >
    <a
      href="/pt/athlete/ai-workout"
      style={{
        minHeight: 58,
        borderRadius: 13,
        background: "#ffd200",
        color: "#071d3d",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "10px 9px",
        fontSize: 12,
        lineHeight: 1.15,
        textAlign: "center",
        fontWeight: 900,
        textDecoration: "none",
      }}
    ><Sparkles size={17} />Criar treino com IA</a>
    <a
      href="/pt/athlete/performance"
      style={{
        minHeight: 58,
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
        lineHeight: 1.15,
        textAlign: "center",
        fontWeight: 900,
        textDecoration: "none",
      }}
    ><TrendingUp size={17} />Acompanhar resultados</a>
  </aside>;
}
