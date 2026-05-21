import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Points next-intl at the request-config module that resolves locale + loads
// the messages catalog on every request.
const withNextIntl = createNextIntlPlugin("./app/lib/i18n/request.ts");

const nextConfig: NextConfig = {
  /* config options here */
};

export default withNextIntl(nextConfig);
