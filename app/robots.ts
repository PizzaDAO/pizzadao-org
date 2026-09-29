import type { MetadataRoute } from "next";
import { SITE_URL } from "@/app/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/announce",
          "/dashboard/",
          "/me/",
          "/profile/*/edit",
          "/articles/new",
          "/articles/*/edit",
          "/vote/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
