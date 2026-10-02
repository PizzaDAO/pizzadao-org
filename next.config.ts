import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Points next-intl at the request-config module that resolves locale + loads
// the messages catalog on every request.
const withNextIntl = createNextIntlPlugin("./app/lib/i18n/request.ts");

// Sites allowed to frame this app. The OAuth "break out of iframe" logic in
// OnboardingWizard / pep exists because PizzaDAO properties have embedded the
// app, so instead of a blanket DENY we only allow PizzaDAO-owned origins.
// Tighten to 'none' once no embeds remain.
const FRAME_ANCESTORS = [
  "'self'",
  "https://pizzadao.org",
  "https://*.pizzadao.org",
  "https://rsv.pizza",
  "https://*.rsv.pizza",
].join(" ");

// Content-Security-Policy, shipped in REPORT-ONLY mode so it can't break
// anything yet. Watch the browser console for violations, then promote it to
// an enforcing `Content-Security-Policy` header.
//
// Built from what the app actually loads:
//   - Next.js App Router inline bootstrap scripts / styled inline styles
//   - RainbowKit + wagmi: WalletConnect relay/verify/explorer, Coinbase &
//     MetaMask SDKs, and viem's default public RPCs for our chains
//     (mainnet, base, polygon, optimism, zora) plus Alchemy
//   - Images: avatars, POAP artwork and NFT media come from many hosts
//     (Discord CDN, POAP, IPFS gateways, Alchemy/OpenSea CDNs, TMDB, Google,
//     Vercel Blob...), so img-src allows any https source
//   - Vercel toolbar / live comments on preview deployments (vercel.live)
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self' https://discord.com",
  `frame-ancestors ${FRAME_ANCESTORS}`,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com https://vercel.live",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  [
    "connect-src 'self'",
    // WalletConnect / Reown
    "https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org",
    "https://*.reown.com wss://*.reown.com https://api.web3modal.org",
    // Coinbase Wallet SDK, MetaMask SDK
    "https://*.coinbase.com wss://*.coinbase.com",
    "https://metamask-sdk.api.cx.metamask.io wss://metamask-sdk.api.cx.metamask.io",
    // Chain RPCs (viem defaults + Alchemy)
    "https://eth.merkle.io https://cloudflare-eth.com https://mainnet.base.org https://polygon-rpc.com",
    "https://mainnet.optimism.io https://rpc.zora.energy https://*.g.alchemy.com",
    // Vercel Blob, Vercel toolbar on previews
    "https://*.public.blob.vercel-storage.com",
    "https://vercel.live wss://ws-us3.pusher.com",
  ].join(" "),
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org https://vercel.live",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: `frame-ancestors ${FRAME_ANCESTORS}` },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in the app uses the camera, microphone or geolocation.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default withNextIntl(nextConfig);
