import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StudyNest",
    short_name: "StudyNest",
    description: "Notes, lecture files and revision for every subject.",
    start_url: "/subjects",
    display: "standalone",
    background_color: "#fffdf5",
    theme_color: "#ffe45c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
