import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { mainnet, base, polygon, optimism, zora } from "viem/chains";

export const config = getDefaultConfig({
  appName: "PizzaDAO",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "demo",
  chains: [mainnet, base, polygon, optimism, zora],
  ssr: true,
});
