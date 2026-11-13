// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contactEmail, escapeHtml, parseContact, parseNewsletter } from "./forms";

describe("parseNewsletter", () => {
  it("lower-cases and trims the address and defaults the source", () => {
    expect(parseNewsletter({ email: "  Me@Example.ORG " })).toEqual({ ok: true, value: { email: "me@example.org", source: "journal" } });
  });
  it("keeps a source but caps it at 64 characters", () => {
    const r = parseNewsletter({ email: "a@b.co", source: "x".repeat(100) });
    expect(r.ok && r.value.source).toHaveLength(64);
  });
  it.each([[{}], [null], [{ email: "nope" }], [{ email: `${"a".repeat(320)}@b.co` }], [{ email: 5 }]])("rejects %j", (body) => {
    expect(parseNewsletter(body)).toEqual({ ok: false, error: "Invalid email" });
  });
});

describe("parseContact", () => {
  const good = { name: " Ada ", organization: " ", email: "ada@example.org", message: " hi ", intents: ["Partnership", 3, "Press"] };
  it("trims, nulls an empty organization and keeps string intents", () => {
    expect(parseContact(good)).toEqual({
      ok: true,
      value: { name: "Ada", organization: null, email: "ada@example.org", message: "hi", intents: ["Partnership", "Press"] },
    });
  });
  it("caps intents at 12", () => {
    const r = parseContact({ ...good, intents: Array.from({ length: 20 }, (_, i) => `t${i}`) });
    expect(r.ok && r.value.intents).toHaveLength(12);
  });
  it.each([
    [{ ...good, name: "" }, "Invalid name"],
    [{ ...good, name: "x".repeat(201) }, "Invalid name"],
    [{ ...good, email: "bad" }, "Invalid email"],
    [{ ...good, message: "" }, "Invalid message"],
    [{ ...good, message: "x".repeat(5001) }, "Invalid message"],
    [{ ...good, organization: "x".repeat(201) }, "Invalid organization"],
  ])("rejects %#", (body, error) => {
    expect(parseContact(body)).toEqual({ ok: false, error });
  });
});

describe("contactEmail", () => {
  it("escapes everything a visitor typed", () => {
    const m = contactEmail("id1", { name: "<b>A</b>", organization: "O&Co", email: "a@b.co", message: "<script>x</script>", intents: ["Partnership"] });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("O&amp;Co");
    expect(m.subject).toBe("New PizzaDAO note from <b>A</b> (Partnership)");
    expect(m.text).toContain("Organization: O&Co");
  });
  it("escapeHtml handles quotes", () => {
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});
