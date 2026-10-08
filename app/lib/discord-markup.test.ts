import { describe, it, expect } from "vitest"
import { parseDiscordMarkup, extractMentionIds, extractMentionIdsFromAll } from "./discord-markup"

describe("parseDiscordMarkup", () => {
  it("returns a single text token for plain text", () => {
    expect(parseDiscordMarkup("Share a pizza photo")).toEqual([
      { type: "text", text: "Share a pizza photo" },
    ])
  })

  it("returns no tokens for empty text", () => {
    expect(parseDiscordMarkup("")).toEqual([])
  })

  it("resolves a channel mention by id", () => {
    const tokens = parseDiscordMarkup("post in <#1099323056012394556> today", {
      channels: { "1099323056012394556": "partnerships" },
    })
    expect(tokens).toEqual([
      { type: "text", text: "post in " },
      { type: "channel", id: "1099323056012394556", name: "partnerships" },
      { type: "text", text: " today" },
    ])
  })

  it("falls back to a null name for an unresolved channel mention", () => {
    const tokens = parseDiscordMarkup("<#123456789012345678>")
    expect(tokens).toEqual([{ type: "channel", id: "123456789012345678", name: null }])
  })

  it("resolves a role mention by id", () => {
    const tokens = parseDiscordMarkup("tag <@&815277786012975134> please", {
      roles: { "815277786012975134": "Partnerships Crew" },
    })
    expect(tokens).toEqual([
      { type: "text", text: "tag " },
      { type: "role", id: "815277786012975134", name: "Partnerships Crew" },
      { type: "text", text: " please" },
    ])
  })

  it("falls back to a null name for an unresolved role mention", () => {
    expect(parseDiscordMarkup("<@&815277786012975134>")).toEqual([
      { type: "role", id: "815277786012975134", name: null },
    ])
  })

  it("parses user mentions in both nickname forms", () => {
    expect(parseDiscordMarkup("<@123456789012345678>")).toEqual([
      { type: "user", id: "123456789012345678" },
    ])
    expect(parseDiscordMarkup("<@!123456789012345678>")).toEqual([
      { type: "user", id: "123456789012345678" },
    ])
  })

  it("parses a static custom emoji", () => {
    expect(parseDiscordMarkup("nice <:frankpepe_trade:1234826199080112138>")).toEqual([
      { type: "text", text: "nice " },
      { type: "emoji", id: "1234826199080112138", name: "frankpepe_trade", animated: false },
    ])
  })

  it("parses an animated custom emoji", () => {
    expect(parseDiscordMarkup("<a:frankpepe_trade:1234826199080112138>")).toEqual([
      { type: "emoji", id: "1234826199080112138", name: "frankpepe_trade", animated: true },
    ])
  })

  it("parses a markdown link", () => {
    const tokens = parseDiscordMarkup(
      "see [PizzaDAO's treasury](https://treasury.pizzadao.xyz) now",
    )
    expect(tokens).toEqual([
      { type: "text", text: "see " },
      { type: "link", href: "https://treasury.pizzadao.xyz", text: "PizzaDAO's treasury" },
      { type: "text", text: " now" },
    ])
  })

  it("ignores a markdown-link-shaped non-http href", () => {
    // The href group requires http(s); a javascript: URL should not match
    // the link alternative and is left as plain text instead.
    const tokens = parseDiscordMarkup("[click](javascript:alert(1))")
    expect(tokens.some((t) => t.type === "link")).toBe(false)
  })

  it("linkifies a bare url", () => {
    expect(parseDiscordMarkup("go to https://pizzadao.xyz/join now")).toEqual([
      { type: "text", text: "go to " },
      { type: "link", href: "https://pizzadao.xyz/join", text: "https://pizzadao.xyz/join" },
      { type: "text", text: " now" },
    ])
  })

  it("handles the full real-world example with a channel, role and emoji", () => {
    const text =
      "Now tag <@&815277786012975134> in <#1099323056012394556> and suggest a new partner PizzaDAO should work with. <a:frankpepe_trade:1234826199080112138>"
    const tokens = parseDiscordMarkup(text, {
      roles: { "815277786012975134": "Partnerships" },
      channels: { "1099323056012394556": "partner-suggestions" },
    })
    expect(tokens).toEqual([
      { type: "text", text: "Now tag " },
      { type: "role", id: "815277786012975134", name: "Partnerships" },
      { type: "text", text: " in " },
      { type: "channel", id: "1099323056012394556", name: "partner-suggestions" },
      { type: "text", text: " and suggest a new partner PizzaDAO should work with. " },
      { type: "emoji", id: "1234826199080112138", name: "frankpepe_trade", animated: true },
    ])
  })

  it("strips a malformed role mention (id too short) as unknown", () => {
    const tokens = parseDiscordMarkup("tag <@&12> please")
    expect(tokens).toEqual([
      { type: "text", text: "tag " },
      { type: "unknown", raw: "<@&12>" },
      { type: "text", text: " please" },
    ])
  })

  it("strips a malformed channel mention (id too short) as unknown", () => {
    expect(parseDiscordMarkup("<#12>")).toEqual([{ type: "unknown", raw: "<#12>" }])
  })

  it("strips a Discord timestamp tag as unknown", () => {
    expect(parseDiscordMarkup("due <t:1700000000:R>")).toEqual([
      { type: "text", text: "due " },
      { type: "unknown", raw: "<t:1700000000:R>" },
    ])
  })

  it("strips a malformed/empty emoji tag as unknown", () => {
    expect(parseDiscordMarkup("<::>")).toEqual([{ type: "unknown", raw: "<::>" }])
  })

  it("handles a markdown link plus channel mention and trailing emoji", () => {
    const text =
      "Let everyone know the state of [PizzaDAO's treasury](https://treasury.pizzadao.xyz) in <#812097286476922943> so we don't overspend. 🧮"
    const tokens = parseDiscordMarkup(text, {
      channels: { "812097286476922943": "treasury-talk" },
    })
    expect(tokens).toEqual([
      { type: "text", text: "Let everyone know the state of " },
      { type: "link", href: "https://treasury.pizzadao.xyz", text: "PizzaDAO's treasury" },
      { type: "text", text: " in " },
      { type: "channel", id: "812097286476922943", name: "treasury-talk" },
      { type: "text", text: " so we don't overspend. 🧮" },
    ])
  })
})

describe("extractMentionIds", () => {
  it("collects channel and role ids, deduped", () => {
    const text = "<#11111> and <#11111> again, also <@&22222> and <@&33333>"
    expect(extractMentionIds(text)).toEqual({
      channelIds: ["11111"],
      roleIds: ["22222", "33333"],
    })
  })

  it("returns empty arrays when there are no mentions", () => {
    expect(extractMentionIds("nothing to see here")).toEqual({ channelIds: [], roleIds: [] })
  })

  it("does not pick up user mentions", () => {
    expect(extractMentionIds("<@123456789012345678>")).toEqual({ channelIds: [], roleIds: [] })
  })
})

describe("extractMentionIdsFromAll", () => {
  it("merges and dedupes ids across several texts", () => {
    const result = extractMentionIdsFromAll([
      "tag <@&11111> in <#999999999999999999>",
      "also <@&11111> and <#999999999999999999>",
      "no mentions here",
    ])
    expect(result.roleIds).toEqual(["11111"])
    expect(result.channelIds).toEqual(["999999999999999999"])
  })
})
