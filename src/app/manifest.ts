import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aegis - Sui Intent Guardian",
    short_name: "Aegis",
    description: "Guarded AI intent execution on Sui.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F3EE",
    theme_color: "#F7F3EE",
    categories: ["finance", "defi", "blockchain", "productivity"],
  };
}
