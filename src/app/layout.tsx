import type { Metadata } from "next";
import { DM_Mono, DM_Serif_Display, Instrument_Sans } from "next/font/google";
import { siteConfig } from "@/lib/site";
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
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: "%s | Aegis",
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: "Aegis" }],
  creator: "Aegis",
  publisher: "Aegis",
  category: "finance",
  keywords: siteConfig.keywords,
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.shortDescription,
  },
  other: { "theme-color": "#F7F3EE" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: siteConfig.name,
              applicationCategory: "FinanceApplication",
              operatingSystem: "Web",
              description: siteConfig.description,
              url: siteConfig.url,
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            }).replace(/</g, "\\u003c"),
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
