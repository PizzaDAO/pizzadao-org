import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { REMOTE_IMAGE_PATTERNS } from "./app/lib/image-hosts";
import { legacyAssetRedirects, legacyDashboardRedirects } from "./app/lib/legacy-paths";
import { marketingHomeAtRoot, wizardParamRedirects } from "./app/lib/marketing-site";
import { hstsHeaderValue } from "./app/lib/hsts";
import { COMMUNITY_CALL_ATTENDANCE_ID, NON_ROSTER_CREW_IDS } from "./app/lib/crew-id";
import { SITE_URL } from "./app/lib/site-url";

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
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://va.vercel-scripts.com https://us-assets.i.posthog.com https://eu-assets.i.posthog.com",
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
    // rsv-pizza API (payee tax-form page /tax-form)
    "https://api.rsv.pizza",
    // Marketing pages (app/(marketing)): PostHog, film posters (Wikipedia), world map data (jsDelivr)
    "https://us.i.posthog.com https://us-assets.i.posthog.com https://eu.i.posthog.com https://eu-assets.i.posthog.com",
    "https://en.wikipedia.org https://cdn.jsdelivr.net",
  ].join(" "),
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org https://vercel.live",
  "worker-src 'self' blob:",
  // `upgrade-insecure-requests` is omitted: browsers ignore it in a
  // Report-Only policy and warn on every page. Add it back when this policy
  // is promoted to an enforced Content-Security-Policy header.
].join("; ");

// CSP only matters on documents (HTML pages, API/route responses); it is dead weight on fingerprinted
// bundles and static images. These are the public/ directories plus Next's own asset routes.
const STATIC_ASSET_DIRS = ["marketing", "brand-kit", "media", "pfp", "toppings", "turtles"];
const CSP_SOURCE = `/((?!_next/static/|_next/image|${STATIC_ASSET_DIRS.map((d) => `${d}/`).join("|")}).*)`;

const CSP_HEADERS = [
  { key: "Content-Security-Policy", value: `frame-ancestors ${FRAME_ANCESTORS}` },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in the app uses the camera, microphone or geolocation.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // No includeSubDomains when this build is the apex (see app/lib/hsts.ts).
  { key: "Strict-Transport-Security", value: hstsHeaderValue(SITE_URL) },
];

const nextConfig: NextConfig = {
  // Call transcription decodes Ogg/Opus with a WebAssembly decoder whose optional Web Worker code
  // does not bundle; load it from node_modules at runtime instead (it is still traced into the function).
  serverExternalPackages: ["ogg-opus-decoder"],
  images: {
    remotePatterns: REMOTE_IMAGE_PATTERNS,
    formats: ["image/avif", "image/webp"],
    // Phone-first widths: most visitors are on mobile, so keep the small steps dense.
    deviceSizes: [360, 480, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [32, 48, 64, 96, 128, 192, 256, 384],
    // 75 is the default; 85 is for the full-bleed heroes and the ritual photo, where the crop magnifies the image.
    qualities: [75, 85],
    // Optimized variants rarely change; cache them for 30 days at the edge/browser.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  // The marketing home page lives at /home. While NEXT_PUBLIC_MARKETING_HOME_AT_ROOT is on, "/" serves
  // it (a rewrite, so the address stays "/") and /home redirects to "/"; the onboarding wizard is
  // always at /start. Off (the default), "/" is the wizard exactly as before.
  async rewrites() {
    return {
      beforeFiles: marketingHomeAtRoot() ? [{ source: "/", destination: "/home" }] : [],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    // The old site's /dashboard/<section> prototype pages go to "/" before /dashboard/[id] can read them as a member id.
    // /app and bare /api (people typing the old app.pizzadao.org address as a path) go to the wizard,
    // which is what the old app host's "/" showed. Exact paths only: /api/* routes are untouched.
    const appEntry = ["/app", "/api"].map((source) => ({ source, destination: "/start", permanent: false }));
    // The Community Call is not a crew: its old crew page goes to the call list, filtered to it, before the page renders.
    const communityCall = [...NON_ROSTER_CREW_IDS].map((id) => ({ source: `/crew/${id}`, destination: `/calls?crew=${COMMUNITY_CALL_ATTENDANCE_ID}`, permanent: false }));
    // Retired legacy poll voting (/vote/<pollId>): voting lives in the proposals system now.
    const retiredVote = ["/vote", "/vote/:path*"].map((source) => ({ source, destination: "/proposals", permanent: true }));
    const legacy = [...appEntry, ...retiredVote, ...communityCall, ...legacyDashboardRedirects(), ...legacyAssetRedirects()];
    return marketingHomeAtRoot() ? [...wizardParamRedirects(), ...legacy, { source: "/home", destination: "/", permanent: false }] : legacy;
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: CSP_SOURCE, headers: CSP_HEADERS },
      // Files in public/ are served `max-age=0, must-revalidate` by default, so every repeat view
      // revalidates every image. Names are not fingerprinted, so cache for a day and let stale
      // copies serve for a week while they refresh in the background.
      ...STATIC_ASSET_DIRS.map((dir) => ({
        source: `/${dir}/:path*`,
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      })),
      // Payee tax-form links carry a secret token in the query string: keep it out of
      // referrers, search indexes and caches. Listed after the global rule so these win.
      {
        source: "/tax-form",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
