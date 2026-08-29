import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AquaOS Coach",
    short_name: "AquaOS",
    description: "Planejamento e inteligência para natação de alto rendimento.",
    start_url: "/pt/coach/today",
    display: "standalone",
    background_color: "#f3f7f6",
    theme_color: "#0b2028",
    orientation: "portrait-primary",
  };
}
