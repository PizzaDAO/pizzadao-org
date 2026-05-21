// app/me/wallets/layout.tsx
//
// Lazy-loads Web3 providers (WagmiProvider + RainbowKitProvider) so the
// <WalletManager/> rendered inside /me/wallets can call useAccount() and
// render the ConnectButton without crashing.
//
// Mirrors the dashboard's layout — see app/dashboard/[id]/layout.tsx.
"use client";

import dynamic from "next/dynamic";

const Web3Providers = dynamic(
  () => import("@/app/lib/web3-providers").then((m) => ({ default: m.Web3Providers })),
  { ssr: false }
);

export default function WalletsLayout({ children }: { children: React.ReactNode }) {
  return <Web3Providers>{children}</Web3Providers>;
}
