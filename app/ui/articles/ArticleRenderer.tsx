"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ArticleRendererProps {
  content: string;
}

/**
 * Renders article markdown content with themed styles.
 * Uses react-markdown with remark-gfm for GitHub-flavored markdown.
 * Safe by default: no rehype-raw, no arbitrary HTML.
 *
 * jalapeno-18281 (Restyle Phase 4a): switched to cream/ink/tomato/butter
 * tokens — Asap body, Asap Condensed headings, tomato links, ink-soft
 * code surfaces, muted-foreground italic figcaptions.
 */
export default function ArticleRenderer({ content }: ArticleRendererProps) {
  return (
    <div className="article-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              {...props}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
            >
              {children}
            </a>
          ),
          // eslint-disable-next-line @next/next/no-img-element
          img: ({ src, alt, title }) => {
            const imgEl = (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={typeof src === "string" ? src : undefined}
                alt={alt || ""}
                style={{
                  maxWidth: "100%",
                  height: "auto",
                  borderRadius: "var(--radius)",
                  border: "1px solid hsl(var(--rule) / 0.12)",
                }}
              />
            );
            if (title) {
              return (
                <figure style={{ margin: "20px 0", padding: 0 }}>
                  {imgEl}
                  <figcaption
                    style={{
                      marginTop: 8,
                      fontSize: "0.875em",
                      fontStyle: "italic",
                      color: "hsl(var(--muted-foreground))",
                      textAlign: "left",
                      lineHeight: 1.4,
                    }}
                  >
                    {title}
                  </figcaption>
                </figure>
              );
            }
            return <span style={{ display: "block", margin: "20px 0" }}>{imgEl}</span>;
          },
        }}
      >
        {content}
      </ReactMarkdown>

      <style jsx global>{`
        .article-content {
          color: hsl(var(--foreground));
          line-height: 1.75;
          font-size: 17px;
          font-family: var(--font-sans), system-ui, sans-serif;
          word-wrap: break-word;
        }
        .article-content p {
          margin: 1.1em 0;
          text-wrap: pretty;
        }
        .article-content h1,
        .article-content h2,
        .article-content h3,
        .article-content h4,
        .article-content h5,
        .article-content h6 {
          color: hsl(var(--foreground));
          font-family: var(--font-display), var(--font-sans), system-ui, sans-serif;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.2;
          margin-top: 1.8em;
          margin-bottom: 0.5em;
          text-wrap: balance;
        }
        .article-content h1 {
          font-size: 2em;
          padding-bottom: 0.3em;
          border-bottom: 1px solid hsl(var(--rule) / 0.12);
        }
        .article-content h2 {
          font-size: 1.55em;
          padding-bottom: 0.25em;
          border-bottom: 1px solid hsl(var(--rule) / 0.12);
        }
        .article-content h3 {
          font-size: 1.28em;
        }
        .article-content h4 {
          font-size: 1.08em;
        }
        .article-content ul {
          margin: 1em 0;
          padding-left: 1.6em;
          list-style-type: disc;
        }
        .article-content ol {
          margin: 1em 0;
          padding-left: 1.6em;
          list-style-type: decimal;
        }
        .article-content li {
          margin: 0.35em 0;
        }
        .article-content li > p {
          margin: 0.35em 0;
        }
        .article-content blockquote {
          margin: 1.5em 0;
          padding: 0.6em 1.1em;
          border-left: 4px solid hsl(var(--tomato));
          background: hsl(var(--ink) / 0.04);
          color: hsl(var(--ink-soft));
          border-radius: 0 var(--radius) var(--radius) 0;
        }
        [data-theme="dark"] .article-content blockquote {
          background: hsl(var(--cream) / 0.06);
          color: hsl(var(--muted-foreground));
        }
        .article-content blockquote > :first-child {
          margin-top: 0;
        }
        .article-content blockquote > :last-child {
          margin-bottom: 0;
        }
        .article-content code {
          font-family: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.9em;
          padding: 0.18em 0.4em;
          background: hsl(var(--ink) / 0.04);
          border: 1px solid hsl(var(--rule) / 0.12);
          border-radius: 6px;
        }
        [data-theme="dark"] .article-content code {
          background: hsl(var(--cream) / 0.06);
        }
        .article-content pre {
          font-family: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          background: hsl(var(--ink) / 0.04);
          border: 1px solid hsl(var(--rule) / 0.12);
          border-radius: var(--radius);
          padding: 16px 18px;
          overflow-x: auto;
          margin: 1.4em 0;
          font-size: 0.9em;
          line-height: 1.55;
        }
        [data-theme="dark"] .article-content pre {
          background: hsl(var(--cream) / 0.06);
        }
        .article-content pre code {
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 0;
          font-size: 1em;
        }
        .article-content a {
          color: hsl(var(--tomato));
          text-decoration: underline;
          text-underline-offset: 3px;
          text-decoration-thickness: 1px;
          transition: color 150ms ease;
        }
        .article-content a:hover {
          color: hsl(var(--tomato-deep));
          text-decoration: none;
        }
        .article-content hr {
          border: none;
          border-top: 1px solid hsl(var(--rule) / 0.12);
          margin: 2em 0;
        }
        .article-content table {
          border-collapse: collapse;
          width: 100%;
          margin: 1.4em 0;
          font-size: 0.95em;
        }
        .article-content th,
        .article-content td {
          border: 1px solid hsl(var(--rule) / 0.12);
          padding: 10px 14px;
          text-align: left;
        }
        .article-content th {
          background: hsl(var(--ink) / 0.04);
          font-family: var(--font-display), var(--font-sans), system-ui, sans-serif;
          font-weight: 700;
        }
        [data-theme="dark"] .article-content th {
          background: hsl(var(--cream) / 0.06);
        }
        .article-content img {
          max-width: 100%;
          height: auto;
        }
        .article-content strong {
          font-weight: 700;
        }
        .article-content em {
          font-style: italic;
        }
        .article-content del {
          text-decoration: line-through;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}
