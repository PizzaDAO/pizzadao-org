import { describe, expect, it } from "vitest";
import { renderNewsletter } from "./render";
import { emptySections } from "./sections";

const full = () => {
  const s = emptySections();
  s.intro = "Welcome <b>friends</b>.\n\nSecond paragraph.";
  s.xSpace = { enabled: true, headline: "Join our X Space today at 4:20pm ET", detail: "4:20pm ET is 21:20 UTC.", url: "https://x.com/i/spaces/abc" };
  s.member = { enabled: true, submissionId: 1, name: "Nominee", city: "Town", blurb: "Did good things.", links: ["https://example.org/a", "javascript:alert(1)"], photoUrl: "https://blob.example/a.jpg" };
  s.city = { enabled: true, cityKey: "k", name: "Alpha", notes: "notes", blurb: "City text." };
  s.partner = { enabled: true, name: "Sponsor", website: "https://sponsor.example", logoUrl: "", blurb: "Partner text.", notifiedNote: "SECRET INTERNAL NOTE" };
  s.events = {
    enabled: true,
    intro: "",
    items: [
      { id: "discord:1", name: "Community call", startsAt: "2026-12-12T18:00:00.000Z", url: "https://discord.com/events/1/2", included: true },
      { id: "discord:2", name: "Unticked", startsAt: "2026-12-13T18:00:00.000Z", url: "", included: false },
    ],
  };
  s.calls = {
    enabled: true,
    intro: "",
    crews: [{ id: "ops", label: "Ops Crew", summary: "Reviewed the backlog.", bullets: [], shipped: ["Shipped the guide"], url: "https://app.example.org/calls/c1", included: true }],
  };
  s.articles = {
    enabled: true,
    intro: "Fresh reads.",
    items: [{ id: "1", title: "Hello <script>", author: "Writer", excerpt: "An excerpt.", coverImage: "", url: "https://app.example.org/articles/hello", included: true }],
  };
  return s;
};
const input = () => ({ subject: "December news", preheader: "What happened this month", sections: full() });

describe("newsletter rendering", () => {
  it("renders email-safe HTML and plain text (snapshot)", () => {
    const out = renderNewsletter(input(), {
      unsubscribeUrl: "https://app.example.org/newsletter/unsubscribe?s=1&sig=2",
      viewInBrowserUrl: "https://app.example.org/newsletter/2026-12",
      postalAddress: "1 Example Street, Town",
    });
    expect(out.html).toMatchSnapshot("html");
    expect(out.text).toMatchSnapshot("text");
  });

  it("escapes everything and only emits https links", () => {
    const { html } = renderNewsletter(input());
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hello &lt;script&gt;");
    expect(html).toContain("Welcome &lt;b&gt;friends&lt;/b&gt;.");
    expect(html).not.toContain("javascript:");
  });

  it("never renders the internal sponsor note or unticked items", () => {
    const { html, text } = renderNewsletter(input());
    expect(html + text).not.toContain("SECRET INTERNAL NOTE");
    expect(html + text).not.toContain("Unticked");
  });

  it("omits sections that are off or empty", () => {
    const s = emptySections();
    s.intro = "Only an intro.";
    s.articles = { enabled: true, intro: "", items: [] };
    const { html, text } = renderNewsletter({ subject: "S", preheader: "", sections: s });
    expect(html).not.toContain("New articles");
    expect(text).not.toContain("NEW ARTICLES");
    expect(html).toContain("Only an intro.");
  });

  it("test sends carry a banner and no per-recipient footer parts", () => {
    const { html, text } = renderNewsletter(input(), { testBanner: "Test send." });
    expect(html).toContain("Test send.");
    expect(text.startsWith("Test send.")).toBe(true);
    expect(html).not.toContain("Unsubscribe");
  });

  it("puts the X Space invite before the other sections", () => {
    const { text } = renderNewsletter(input());
    expect(text.indexOf("Join our X Space")).toBeLessThan(text.indexOf("MEMBER SPOTLIGHT"));
  });
});
