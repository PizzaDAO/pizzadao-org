"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "@/app/lib/hooks/use-session";
import { PizzaDAOLogo } from "./PizzaDAOLogo";

type NavItem = { href: string; label: string; membersOnly?: boolean; adminOnly?: boolean; analyticsOnly?: boolean; match?: (path: string) => boolean };
const GROUPS: { key: string; items: NavItem[] }[] = [
  { key: "community", items: [
    { href: "/crews", label: "crews", match: p => p === "/crews" || p.startsWith("/crew/") },
    { href: "/crew", label: "members", match: p => p === "/crew" },
    { href: "/articles", label: "articles" },
    { href: "/chats", label: "chats", membersOnly: true },
  ] },
  { key: "contribute", items: [
    { href: "/missions", label: "missions" },
    { href: "/pep", label: "pep" },
    { href: "/tech/projects", label: "techProjects" },
  ] },
  { key: "resources", items: [
    { href: "/manuals", label: "manuals" },
    { href: "/turtles", label: "turtles" },
    { href: "/calls", label: "calls" },
    { href: "/nfts", label: "nfts" },
    { href: "/poaps", label: "poaps" },
    { href: "/print", label: "print" },
    { href: "/support", label: "support" },
    { href: "/admin/activation", label: "activation", analyticsOnly: true },
    { href: "/admin/shop", label: "shopAdmin", adminOnly: true },
  ] },
];
const HIDDEN_ON = new Set(["/join", "/login"]);
const activeItem = (item: NavItem, path: string) => item.match ? item.match(path) : path === item.href || path.startsWith(item.href + "/");

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const t = useTranslations("nav");
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [lastPath, setLastPath] = useState(pathname);
  const desktopRef = useRef<HTMLUListElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const mobileButtonRef = useRef<HTMLButtonElement>(null);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
    setOpenGroup(null);
  }

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (openGroup) buttonRefs.current[openGroup]?.focus();
      if (mobileOpen) mobileButtonRef.current?.focus();
      setOpenGroup(null);
      setMobileOpen(false);
    }
    function closeOutside(event: MouseEvent) {
      if (desktopRef.current && !desktopRef.current.contains(event.target as Node)) setOpenGroup(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOutside);
    };
  }, [openGroup, mobileOpen]);

  if (HIDDEN_ON.has(pathname)) return null;
  const loggedIn = !!session?.authenticated;
  const dashboardHref = session?.memberId ? `/dashboard/${session.memberId}` : "/";
  const groups = GROUPS.map(group => ({ ...group, items: group.items.filter(item => (!item.membersOnly || loggedIn) && (!item.adminOnly || session?.canManageShop) && (!item.analyticsOnly || session?.isAdmin)) }));
  const linkClass = "flex min-h-11 items-center rounded-xl px-3 py-2 text-sm no-underline transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tomato-readable";
  const account = loggedIn ? (
    <Link href={dashboardHref} className="btn-pill min-h-11 bg-foreground text-background no-underline" aria-current={pathname.startsWith("/dashboard/") ? "page" : undefined}>{t("dashboard")}</Link>
  ) : (
    <>
      <Link href="/login" className={linkClass + " text-foreground"}>{t("logIn")}</Link>
      <Link href="/join" className="btn-pill min-h-11 bg-tomato-deep text-cream no-underline">{t("join")}</Link>
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-[hsl(var(--rule-warm)/0.55)] bg-background/95 backdrop-blur-md print:hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-background">{t("skipToContent")}</a>
      <nav aria-label={t("mainAriaLabel")} className="mx-auto flex min-h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link href={loggedIn ? dashboardHref : "/"} className="mr-2 inline-flex min-h-11 items-center text-foreground no-underline" aria-label={t("homeAriaLabel")}><PizzaDAOLogo height={28} /></Link>
        <ul ref={desktopRef} className="m-0 hidden list-none items-center gap-1 p-0 lg:flex" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenGroup(null); }}>
          {groups.map(group => {
            const expanded = openGroup === group.key;
            const active = group.items.some(item => activeItem(item, pathname));
            return (
              <li key={group.key} className="relative">
                <button ref={el => { buttonRefs.current[group.key] = el; }} type="button" aria-expanded={expanded} aria-controls={`nav-${group.key}`} onClick={() => setOpenGroup(expanded ? null : group.key)} className={`flex min-h-11 cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-tomato-readable ${active || expanded ? "text-tomato-readable" : "text-foreground/80"}`}>
                  {t(group.key)}<ChevronDown size={15} aria-hidden className={expanded ? "rotate-180" : ""} />
                </button>
                {expanded && (
                  <ul id={`nav-${group.key}`} className="absolute left-0 top-full m-0 mt-1 min-w-[230px] list-none rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] bg-card p-2 shadow-lg">
                    {group.items.map(item => <li key={item.href}><Link href={item.href} aria-current={activeItem(item, pathname) ? "page" : undefined} className={`${linkClass} ${activeItem(item, pathname) ? "font-semibold text-tomato-readable" : "text-foreground"}`}>{t(item.label)}</Link></li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">{account}</div>
          <button ref={mobileButtonRef} type="button" aria-expanded={mobileOpen} aria-controls="site-nav-mobile" aria-label={mobileOpen ? t("closeMenu") : t("openMenu")} onClick={() => setMobileOpen(value => !value)} className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-[hsl(var(--rule-warm)/0.55)] bg-transparent text-foreground lg:hidden">{mobileOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}</button>
        </div>
      </nav>
      {mobileOpen && (
        <div id="site-nav-mobile" className="max-h-[calc(100svh-4rem)] overflow-y-auto border-t border-[hsl(var(--rule-warm)/0.55)] bg-card lg:hidden">
          <div className="mx-auto grid max-w-[1200px] gap-5 px-4 pb-6 pt-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 sm:hidden">{account}</div>
            {groups.map(group => <section key={group.key} aria-label={t(group.key)}><h2 className="overline m-0 mb-1 text-tomato-readable">{t(group.key)}</h2><ul className="m-0 grid list-none grid-cols-2 gap-x-2 p-0">{group.items.map(item => <li key={item.href}><Link href={item.href} aria-current={activeItem(item, pathname) ? "page" : undefined} className={`${linkClass} ${activeItem(item, pathname) ? "font-semibold text-tomato-readable" : "text-foreground"}`}>{t(item.label)}</Link></li>)}</ul></section>)}
          </div>
        </div>
      )}
    </header>
  );
}
