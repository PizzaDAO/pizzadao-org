// Server-rendered Markdown for handbook pages. No raw HTML (no rehype-raw). Headings take an
// explicit trailing `{#anchor}` as their id so deep links are identical in every language.
import Link from "next/link";
import { Children, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./handbook.css";

const ANCHOR_SUFFIX = /\s*\{#([a-z0-9-]+)\}\s*$/;

/** Pull a trailing `{#anchor}` off the last text child of a heading. */
export function splitHeadingAnchor(children: ReactNode): { id?: string; children: ReactNode } {
    const parts = Children.toArray(children);
    const last = parts[parts.length - 1];
    if (typeof last === "string") {
        const m = ANCHOR_SUFFIX.exec(last);
        if (m) return { id: m[1], children: [...parts.slice(0, -1), last.replace(ANCHOR_SUFFIX, "")] };
    }
    return { children };
}

export function HandbookMarkdown({ content }: { content: string }) {
    return (
        <div className="handbook-content">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                disallowedElements={["img"]}
                unwrapDisallowed
                components={{
                    h2: ({ children }) => {
                        const h = splitHeadingAnchor(children);
                        return <h2 id={h.id}>{h.children}</h2>;
                    },
                    h3: ({ children }) => {
                        const h = splitHeadingAnchor(children);
                        return <h3 id={h.id}>{h.children}</h3>;
                    },
                    a: ({ href, children }) => {
                        if (href && /^\/(?![\/\\])/.test(href)) return <Link href={href}>{children}</Link>;
                        if (href && href.startsWith("#")) return <a href={href}>{children}</a>;
                        return (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        );
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
