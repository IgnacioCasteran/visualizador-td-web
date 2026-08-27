import type {
  Metadata,
  Viewport,
} from "next";
import {
  Geist,
  Geist_Mono,
} from "next/font/google";

import PWARegister from "@/components/PWARegister";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "La Casa del Tren Delantero",
    template: "%s | La Casa del Tren Delantero",
  },
  description:
    "Sistema de consulta de clientes, comprobantes e histórico de artículos",
  applicationName: "Visualizador TD",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Visualizador TD",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      {
        url: "/logo.jpg",
      },
    ],
    apple: [
      {
        url: "/logo.jpg",
      },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#b91c1c",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
