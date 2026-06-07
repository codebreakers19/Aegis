import type { Metadata } from "next";
import { DM_Mono, DM_Serif_Display, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const display = DM_Serif_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
});

const body = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const mono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["300", "400", "500"] });

export const metadata: Metadata = {
  title: "Aegis - Sui Intent Guardian",
  description: "Plain-English DeFi intents compiled into Aegis-protected Sui transactions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
