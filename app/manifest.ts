import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Visualizador TD - La Casa del Tren Delantero",
    short_name: "Visualizador TD",
    description:
      "Sistema de consulta de clientes, comprobantes e histórico de artículos",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#b91c1c",
    lang: "es-AR",
    categories: [
      "business",
      "productivity",
      "utilities",
    ],
    icons: [
      {
        src: "/logo.jpg",
        sizes: "any",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
  };
}
