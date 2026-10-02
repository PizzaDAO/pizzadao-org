// app/lib/i18n/__tests__/catalog-parity.test.ts
//
// Every message key in the English catalog must exist in every other locale
// (across all namespaces), and every translation must be valid ICU that uses
// the same placeholders as English — otherwise next-intl renders the raw key
// or throws at runtime for es/fr users.

import { describe, it, expect } from "vitest";
import { createTranslator } from "next-intl";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import fr from "../../../../messages/fr.json";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "../locales";

type Catalog = { [key: string]: string | Catalog };

const CATALOGS: Record<string, Catalog> = { en, es, fr };

/** Flatten a nested catalog to dotted leaf keys → message. */
function flatten(obj: Catalog, prefix = ""): Map<string, string> {
    const out = new Map<string, string>();
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") out.set(key, v);
        else for (const [ck, cv] of flatten(v, key)) out.set(ck, cv);
    }
    return out;
}

/** Top-level ICU argument names, e.g. "{count, plural, ...}" → "count". */
function argNames(message: string): string[] {
    const names = new Set<string>();
    for (const m of message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*[,}]/g)) names.add(m[1]);
    return [...names].sort();
}

/** Rich-text tag names, e.g. "<b>{name}</b>" → "b". */
function tagNames(message: string): string[] {
    const names = new Set<string>();
    for (const m of message.matchAll(/<([A-Za-z][\w-]*)>/g)) names.add(m[1]);
    return [...names].sort();
}

const enFlat = flatten(en);

describe("message catalog parity", () => {
    it("has a catalog for every supported locale", () => {
        for (const locale of SUPPORTED_LOCALES) expect(CATALOGS[locale]).toBeDefined();
    });

    it("English catalog includes the expected namespaces", () => {
        expect(Object.keys(en)).toEqual(
            expect.arrayContaining(["common", "language", "onboarding", "nav", "dashboard"]),
        );
    });

    for (const locale of SUPPORTED_LOCALES.filter((l) => l !== DEFAULT_LOCALE)) {
        describe(locale, () => {
            const flat = flatten(CATALOGS[locale]);

            it("has every key that exists in en", () => {
                const missing = [...enFlat.keys()].filter((k) => !flat.has(k));
                expect(missing).toEqual([]);
            });

            it("has no keys that are missing from en", () => {
                const extra = [...flat.keys()].filter((k) => !enFlat.has(k));
                expect(extra).toEqual([]);
            });

            it("has no empty translations", () => {
                const empty = [...flat.entries()].filter(([, v]) => v.trim() === "").map(([k]) => k);
                expect(empty).toEqual([]);
            });

            it("uses the same ICU placeholders and rich-text tags as en", () => {
                const sig = (m: string) => `${argNames(m).join()}|${tagNames(m).join()}`;
                const mismatched = [...enFlat.entries()]
                    .filter(([k]) => flat.has(k))
                    .filter(([k, v]) => sig(v) !== sig(flat.get(k)!))
                    .map(([k]) => k);
                expect(mismatched).toEqual([]);
            });
        });
    }

    it("every message in every locale formats as valid ICU", () => {
        const errors: string[] = [];
        for (const locale of SUPPORTED_LOCALES) {
            const t = createTranslator({
                locale,
                messages: CATALOGS[locale],
                onError: (e) => errors.push(`${locale}: ${e.message}`),
            });
            for (const [key, message] of flatten(CATALOGS[locale])) {
                const values = {
                    ...Object.fromEntries(argNames(message).map((n) => [n, 2])),
                    // Rich-text tags (<b>…</b>) are rendered via t.rich in the app.
                    ...Object.fromEntries(
                        tagNames(message).map((n) => [n, (chunks: unknown) => String(chunks)]),
                    ),
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (t as any)(key, values);
            }
        }
        expect(errors).toEqual([]);
    });
});
