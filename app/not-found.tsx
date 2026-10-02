import type { Metadata } from "next";
import Link from "next/link";
import { EditorialNotice } from "@/app/ui/shared/EditorialNotice";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <EditorialNotice
      overline="§ 404 · Off the menu"
      headline="This slice has gone missing."
      body={
        <p className="m-0">
          The page you&apos;re looking for doesn&apos;t exist or has moved. Try one of these
          instead.
        </p>
      }
    >
      <Link
        href="/"
        className="btn-pill no-underline"
        style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))" }}
      >
        Go home
      </Link>
      <Link
        href="/crews"
        className="btn-pill border no-underline"
        style={{ borderColor: "hsl(var(--rule-warm))", color: "hsl(var(--foreground))" }}
      >
        Browse crews
      </Link>
      <Link
        href="/articles"
        className="btn-pill border no-underline"
        style={{ borderColor: "hsl(var(--rule-warm))", color: "hsl(var(--foreground))" }}
      >
        Read articles
      </Link>
    </EditorialNotice>
  );
}
