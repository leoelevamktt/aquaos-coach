import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RKF Coach",
    short_name: "RKF Coach",
    description: "Planejamento, prescrição e acompanhamento para natação de alto rendimento.",
    start_url: "/pt/coach/today",
    display: "standalone",
    background_color: "#f3f6fa",
    theme_color: "#0b1e3f",
    orientation: "portrait-primary",
    shortcuts: [
      { name: "Área do treinador", short_name: "Coach", url: "/pt/coach/today" },
      { name: "Treino do atleta", short_name: "Treino", url: "/pt/athlete/home" },
      { name: "Check-in diário", short_name: "Check-in", url: "/pt/athlete/checkin" },
    ],
  };
}
