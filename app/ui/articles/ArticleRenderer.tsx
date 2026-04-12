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
                style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }}
              />
            );
            if (title) {
              return (
                <figure style={{ margin: "16px 0", padding: 0 }}>
                  {imgEl}
                  <figcaption style={{
                    marginTop: 6,
                    fontSize: "0.85em",
                    color: "var(--color-text-secondary, var(--color-text))",
                    opacity: 0.7,
                    textAlign: "center",
                    lineHeight: 1.4,
                  }}>
                    {title}
                  </figcaption>
                </figure>
              );
            }
            return <span style={{ display: "block", margin: "16px 0" }}>{imgEl}</span>;
          },
        }}
      >
        {content}
      </ReactMarkdown>

      <style jsx global>{`
        .article-content {
          color: var(--color-text);
          line-height: 1.7;
          font-size: 16px;
          word-wrap: break-word;
        }
        .article-content h1,
        .article-content h2,
        .article-content h3,
        .article-content h4,
        .article-content h5,
        .article-content h6 {
          color: var(--color-text-primary, var(--color-text));
          font-weight: 700;
          line-height: 1.25;
          margin-top: 1.8em;
          margin-bottom: 0.6em;
        }
        .article-content h1 {
          font-size: 2em;
          border-bottom: 1px solid var(--color-border);
          padding-bottom: 0.3em;
        }
        .article-content h2 {
          font-size: 1.5em;
          border-bottom: 1px solid var(--color-border);
          padding-bottom: 0.3em;
        }
        .article-content h3 {
          font-size: 1.25em;
        }
        .article-content h4 {
          font-size: 1em;
        }
        .article-content p {
          margin: 1em 0;
        }
        .article-content ul {
          margin: 1em 0;
          padding-left: 2em;
          list-style-type: disc;
        }
        .article-content ol {
          margin: 1em 0;
          padding-left: 2em;
          list-style-type: decimal;
        }
        .article-content li {
          margin: 0.3em 0;
        }
        .article-content li > p {
          margin: 0.3em 0;
        }
        .article-content blockquote {
          margin: 1.2em 0;
          padding: 0.5em 1em;
          border-left: 4px solid var(--color-border-strong, var(--color-border));
          background: var(--color-surface-hover, rgba(0, 0, 0, 0.03));
          color: var(--color-text-secondary, var(--color-text));
          border-radius: 0 8px 8px 0;
        }
        .article-content blockquote > :first-child {
          margin-top: 0;
        }
        .article-content blockquote > :last-child {
          margin-bottom: 0;
        }
        .article-content code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.9em;
          padding: 0.2em 0.4em;
          background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
          border-radius: 4px;
        }
        .article-content pre {
          background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 14px 16px;
          overflow-x: auto;
          margin: 1.2em 0;
          font-size: 0.9em;
          line-height: 1.5;
        }
        .article-content pre code {
          padding: 0;
          background: transparent;
          border-radius: 0;
          font-size: 1em;
        }
        .article-content a {
          color: #2563eb;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .article-content a:hover {
          text-decoration: none;
        }
        .article-content hr {
          border: none;
          border-top: 1px solid var(--color-border);
          margin: 2em 0;
        }
        .article-content table {
          border-collapse: collapse;
          width: 100%;
          margin: 1.2em 0;
          font-size: 0.95em;
        }
        .article-content th,
        .article-content td {
          border: 1px solid var(--color-border);
          padding: 8px 12px;
          text-align: left;
        }
        .article-content th {
          background: var(--color-surface-hover, rgba(0, 0, 0, 0.04));
          font-weight: 700;
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
