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
 * napoletana-41544 (Editorial restyle): newspaper feature treatment.
 *   • Drop cap on the first paragraph
 *   • Larger leading (1.78) and pretty text-wrap
 *   • Display headings with tracking-[-0.015em]
 *   • Tomato underline-scribble for inline links on hover
 *   • Pull-quote blockquote with handwritten attribution feel
 *   • Figcaptions in uppercase micro-type
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
                  border: "1px solid hsl(var(--rule-warm) / 0.55)",
                  boxShadow: "var(--shadow-soft)",
                }}
              />
            );
            if (title) {
              return (
                <figure style={{ margin: "28px 0", padding: 0 }}>
                  {imgEl}
                  <figcaption
                    style={{
                      marginTop: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "hsl(var(--muted-foreground))",
                      textAlign: "left",
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: "hsl(var(--tomato))", marginRight: 8 }}>·</span>
                    {title}
                  </figcaption>
                </figure>
              );
            }
            return <span style={{ display: "block", margin: "28px 0" }}>{imgEl}</span>;
          },
        }}
      >
        {content}
      </ReactMarkdown>

      <style jsx global>{`
        .article-content {
          color: hsl(var(--foreground));
          line-height: 1.78;
          font-size: 18px;
          font-family: var(--font-sans), system-ui, sans-serif;
          word-wrap: break-word;
        }
        .article-content p {
          margin: 1.15em 0;
          text-wrap: pretty;
        }
        /* Drop cap on the first paragraph — newspaper feature treatment.
           Falls back gracefully if no <p> is the first child. */
        .article-content > p:first-child::first-letter {
          font-family: var(--font-display), var(--font-sans), system-ui, sans-serif;
          font-weight: 900;
          float: left;
          font-size: 4.2em;
          line-height: 0.85;
          padding: 0.08em 0.12em 0 0;
          margin-right: 0.04em;
          color: hsl(var(--tomato));
          text-transform: uppercase;
        }
        .article-content h1,
        .article-content h2,
        .article-content h3,
        .article-content h4,
        .article-content h5,
        .article-content h6 {
          color: hsl(var(--foreground));
          font-family: var(--font-display), var(--font-sans), system-ui, sans-serif;
          font-weight: 800;
          letter-spacing: -0.015em;
          line-height: 1.05;
          margin-top: 2em;
          margin-bottom: 0.55em;
          text-wrap: balance;
        }
        .article-content h1 {
          font-size: 2.4em;
          padding-bottom: 0.3em;
          border-bottom: 2px solid hsl(var(--foreground) / 0.85);
        }
        .article-content h2 {
          font-size: 1.75em;
          padding-bottom: 0.25em;
          border-bottom: 1px solid hsl(var(--rule-warm) / 0.6);
        }
        .article-content h2::before {
          /* tomato hairline accent — section anchor */
          content: "§ ";
          color: hsl(var(--tomato));
          font-weight: 800;
          margin-right: 0.15em;
        }
        .article-content h3 {
          font-size: 1.35em;
        }
        .article-content h4 {
          font-size: 1.12em;
          text-transform: uppercase;
          letter-spacing: 0.04em;
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
          margin: 0.4em 0;
        }
        .article-content li::marker {
          color: hsl(var(--tomato));
        }
        .article-content li > p {
          margin: 0.4em 0;
        }
        .article-content blockquote {
          margin: 1.8em 0;
          padding: 0.4em 0 0.4em 1.4em;
          border-left: 3px solid hsl(var(--tomato));
          background: transparent;
          color: hsl(var(--foreground) / 0.85);
          font-family: var(--font-display), var(--font-sans), system-ui, sans-serif;
          font-style: italic;
          font-weight: 500;
          font-size: 1.18em;
          line-height: 1.45;
          letter-spacing: -0.005em;
          text-wrap: pretty;
        }
        .article-content blockquote > :first-child {
          margin-top: 0;
        }
        .article-content blockquote > :last-child {
          margin-bottom: 0;
        }
        .article-content code {
          font-family: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.88em;
          padding: 0.18em 0.4em;
          background: hsl(var(--ink) / 0.05);
          border: 1px solid hsl(var(--rule-warm) / 0.45);
          border-radius: 4px;
        }
        [data-theme="dark"] .article-content code {
          background: hsl(var(--cream) / 0.06);
        }
        .article-content pre {
          font-family: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          background: hsl(var(--ink) / 0.04);
          border: 1px solid hsl(var(--rule-warm) / 0.55);
          border-radius: var(--radius);
          padding: 18px 20px;
          overflow-x: auto;
          margin: 1.6em 0;
          font-size: 0.88em;
          line-height: 1.6;
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
          font-weight: 500;
          transition: color 150ms ease, text-decoration-thickness 150ms ease;
        }
        .article-content a:hover {
          color: hsl(var(--tomato-deep));
          text-decoration-thickness: 2px;
        }
        .article-content hr {
          border: none;
          height: 1px;
          background: linear-gradient(
            to right,
            transparent,
            hsl(var(--foreground) / 0.4),
            transparent
          );
          margin: 2.4em 0;
        }
        .article-content hr::after {
          /* decorative bullet between sections */
          content: "···";
          display: block;
          position: relative;
          top: -0.8em;
          text-align: center;
          color: hsl(var(--tomato));
          background: hsl(var(--background));
          width: fit-content;
          margin: 0 auto;
          padding: 0 0.5em;
          letter-spacing: 0.4em;
          font-weight: 700;
          font-size: 14px;
        }
        .article-content table {
          border-collapse: collapse;
          width: 100%;
          margin: 1.6em 0;
          font-size: 0.95em;
        }
        .article-content th,
        .article-content td {
          border: 1px solid hsl(var(--rule-warm) / 0.55);
          padding: 10px 14px;
          text-align: left;
        }
        .article-content th {
          background: hsl(var(--ink) / 0.04);
          font-family: var(--font-display), var(--font-sans), system-ui, sans-serif;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-size: 0.85em;
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
        /* Mobile — slightly tighter drop cap so it doesn't dominate */
        @media (max-width: 540px) {
          .article-content {
            font-size: 17px;
            line-height: 1.7;
          }
          .article-content > p:first-child::first-letter {
            font-size: 3.4em;
          }
        }
      `}</style>
    </div>
  );
}
