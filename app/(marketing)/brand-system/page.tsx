import BrandSystem from "@/app/(marketing)/_site/pages/BrandSystemPage";
import { pageMeta } from "@/app/(marketing)/_site/meta";

export const metadata = pageMeta({
  path: "/brand-system",
  title: "Brand System",
  description: "The PizzaDAO brand system: logos, Molto Benny, colour, type and downloadable assets.",
});

export default function Page() {
  return (
    <>
      {/* The type specimen shows Solway; it is not part of the app's self-hosted fonts. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Solway:wght@300;400;500;700;800&display=swap" precedence="default" />
      <BrandSystem />
    </>
  );
}
