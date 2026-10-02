import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { REMOTE_IMAGE_PATTERNS } from "./app/lib/image-hosts";

// Points next-intl at the request-config module that resolves locale + loads
// the messages catalog on every request.
const withNextIntl = createNextIntlPlugin("./app/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: REMOTE_IMAGE_PATTERNS,
  },
};

export default withNextIntl(nextConfig);
