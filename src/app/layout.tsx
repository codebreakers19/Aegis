import type { Metadata } from "next";
import { DM_Mono, DM_Serif_Display, Instrument_Sans } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
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
  authors: [{ name: siteConfig.author, url: "https://nikhilraikwar.me" }],
  creator: siteConfig.author,
  publisher: "Aegis",
  category: "finance",
  keywords: siteConfig.keywords,
  alternates: { canonical: "/" },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
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
    images: [{
      url: `${siteConfig.url}/banner.png`,
      secureUrl: `${siteConfig.url}/banner.png`,
      width: 1672,
      height: 941,
      type: "image/png",
      alt: "Aegis guarded intent execution flow on Sui",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.shortDescription,
    creator: "@NikhilRaikwar",
    images: [`${siteConfig.url}/banner.png`],
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
              author: { "@type": "Person", name: siteConfig.author },
              applicationCategory: "FinanceApplication",
              operatingSystem: "Web",
              description: siteConfig.description,
              url: siteConfig.url,
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            }).replace(/</g, "\\u003c"),
          }}
        />
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
