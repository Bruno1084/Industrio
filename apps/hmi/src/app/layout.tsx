import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Sin next/font: la HMI no debe depender de internet (planta aislada).
export const metadata: Metadata = {
  title: "Industrio HMI",
  description: "Supervisión en tiempo real de la planta Industrio.",
};

// Tipo explícito en vez de LayoutProps: ese global lo genera Next en .next/ y
// `npm run typecheck` fallaría en un clon recién instalado.
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
