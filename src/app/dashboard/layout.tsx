import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Connected-wallet Aegis execution dashboard.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
