"use client";

import { ConnectButton, useCurrentWallet } from "@mysten/dapp-kit";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();
  const { connectionStatus } = useCurrentWallet();

  useEffect(() => {
    if (connectionStatus === "connected") router.replace("/dashboard");
  }, [connectionStatus, router]);

  return (
    <main className="landing-shell">
      <iframe className="reference-frame" src="/landing.html" title="Aegis Intent Guardian" />
      <div className="landing-wallet">
        <span>Enter the app</span>
        <ConnectButton connectText="Connect Wallet" />
      </div>
    </main>
  );
}
