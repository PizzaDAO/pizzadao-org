import { describe, it, expect } from "vitest"
import {
  parseDiscordMarkup,
  discordMarkupToPlainText,
  discordTextToPlainText,
  extractMentionIds,
  extractMentionIdsFromAll,
  formatDiscordTimestamp,
  isValidDiscordTimestamp,
} from "./discord-markup"

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

  it("strips a malformed Discord timestamp tag (invalid style letter) as unknown", () => {
    expect(parseDiscordMarkup("due <t:1700000000:Z>")).toEqual([
      { type: "text", text: "due " },
      { type: "unknown", raw: "<t:1700000000:Z>" },
    ])
  })

  it("parses a Discord timestamp with no style as a timestamp token (default style f)", () => {
    expect(parseDiscordMarkup("due <t:1700000000>")).toEqual([
      { type: "text", text: "due " },
      { type: "timestamp", unix: 1700000000, style: "f", raw: "<t:1700000000>" },
    ])
  })

  it("parses a Discord timestamp with an explicit style as a timestamp token", () => {
    expect(parseDiscordMarkup("due <t:1700000000:R>")).toEqual([
      { type: "text", text: "due " },
      { type: "timestamp", unix: 1700000000, style: "R", raw: "<t:1700000000:R>" },
    ])
  })

  it("parses every valid Discord timestamp style", () => {
    for (const style of ["t", "T", "d", "D", "f", "F", "R"] as const) {
      expect(parseDiscordMarkup(`<t:1700000000:${style}>`)).toEqual([
        { type: "timestamp", unix: 1700000000, style, raw: `<t:1700000000:${style}>` },
      ])
    }
  })

  describe("out-of-range timestamps (would otherwise throw from Date/Intl)", () => {
    it("treats a 13-digit UNIX value past the safe Date range as unknown, not a crash", () => {
      // 9,999,999,999,999 * 1000 ms > 8.64e15 — outside what Date can hold.
      expect(() => parseDiscordMarkup("<t:9999999999999>")).not.toThrow()
      expect(parseDiscordMarkup("<t:9999999999999>")).toEqual([
        { type: "unknown", raw: "<t:9999999999999>" },
      ])
    })

    it("treats a 14-digit UNIX value (over the regex's digit cap) as unknown, not a crash", () => {
      expect(() => parseDiscordMarkup("<t:99999999999999:R>")).not.toThrow()
      expect(parseDiscordMarkup("<t:99999999999999:R>")).toEqual([
        { type: "unknown", raw: "<t:99999999999999:R>" },
      ])
    })

    it("treats a 400-digit UNIX value as unknown, not a crash", () => {
      const hugeDigits = "9".repeat(400)
      const text = `<t:${hugeDigits}>`
      expect(() => parseDiscordMarkup(text)).not.toThrow()
      expect(parseDiscordMarkup(text)).toEqual([{ type: "unknown", raw: text }])
    })

    it("isValidDiscordTimestamp rejects non-finite and out-of-range values", () => {
      expect(isValidDiscordTimestamp(1700000000)).toBe(true)
      expect(isValidDiscordTimestamp(8.64e12)).toBe(true)
      expect(isValidDiscordTimestamp(8.65e12)).toBe(false)
      expect(isValidDiscordTimestamp(Infinity)).toBe(false)
      expect(isValidDiscordTimestamp(NaN)).toBe(false)
    })

    it("formatDiscordTimestamp never throws on an out-of-range value, and returns ''", () => {
      expect(() => formatDiscordTimestamp(9999999999999)).not.toThrow()
      expect(formatDiscordTimestamp(9999999999999)).toBe("")
      expect(() => formatDiscordTimestamp(9999999999999, "R")).not.toThrow()
      expect(formatDiscordTimestamp(9999999999999, "R")).toBe("")
    })

    it("discordTextToPlainText never throws and drops an out-of-range timestamp to nothing", () => {
      expect(() => discordTextToPlainText("due <t:9999999999999> soon")).not.toThrow()
      expect(discordTextToPlainText("due <t:9999999999999> soon")).toBe("due  soon")
    })
  })

  it("strips a malformed/empty emoji tag as unknown", () => {
    expect(parseDiscordMarkup("<::>")).toEqual([{ type: "unknown", raw: "<::>" }])
  })

  it("strips a slash-command mention as unknown", () => {
    expect(parseDiscordMarkup("run </tag:815277786012975134>")).toEqual([
      { type: "text", text: "run " },
      { type: "unknown", raw: "</tag:815277786012975134>" },
    ])
  })

  it("strips a slash-command mention with a subcommand (spaces) as unknown", () => {
    expect(parseDiscordMarkup("</tag user set:815277786012975134>")).toEqual([
      { type: "unknown", raw: "</tag user set:815277786012975134>" },
    ])
  })

  it("strips guide/onboarding <id:...> tags as unknown", () => {
    for (const tag of ["<id:customize>", "<id:browse>", "<id:guide>"]) {
      expect(parseDiscordMarkup(tag)).toEqual([{ type: "unknown", raw: tag }])
    }
  })

  it("allows one level of balanced parens in a markdown link href", () => {
    const tokens = parseDiscordMarkup(
      "[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) is relevant",
    )
    expect(tokens).toEqual([
      { type: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)", text: "Foo" },
      { type: "text", text: " is relevant" },
    ])
  })

  it("strips/resolves markup inside markdown link text", () => {
    const tokens = parseDiscordMarkup(
      "[Check <#1099323056012394556> out](https://pizzadao.xyz)",
      { channels: { "1099323056012394556": "partner-suggestions" } },
    )
    expect(tokens).toEqual([
      { type: "link", href: "https://pizzadao.xyz", text: "Check #partner-suggestions out" },
    ])
  })

  it("drops an emoji tag inside markdown link text down to :name:", () => {
    const tokens = parseDiscordMarkup(
      "[Nice <:frankpepe_trade:1234826199080112138> job](https://pizzadao.xyz)",
    )
    expect(tokens).toEqual([
      { type: "link", href: "https://pizzadao.xyz", text: "Nice :frankpepe_trade: job" },
    ])
  })

  it("trims trailing sentence punctuation from a bare url", () => {
    expect(parseDiscordMarkup("go to https://pizzadao.xyz/join!")).toEqual([
      { type: "text", text: "go to " },
      { type: "link", href: "https://pizzadao.xyz/join", text: "https://pizzadao.xyz/join" },
      { type: "text", text: "!" },
    ])
  })

  it("trims a trailing unbalanced close-paren from a bare url", () => {
    expect(parseDiscordMarkup("(see https://pizzadao.xyz/join)")).toEqual([
      { type: "text", text: "(see " },
      { type: "link", href: "https://pizzadao.xyz/join", text: "https://pizzadao.xyz/join" },
      { type: "text", text: ")" },
    ])
  })

  it("keeps a trailing close-paren on a bare url when it balances an earlier open-paren", () => {
    expect(parseDiscordMarkup("see https://en.wikipedia.org/wiki/Foo_(bar) now")).toEqual([
      { type: "text", text: "see " },
      {
        type: "link",
        href: "https://en.wikipedia.org/wiki/Foo_(bar)",
        text: "https://en.wikipedia.org/wiki/Foo_(bar)",
      },
      { type: "text", text: " now" },
    ])
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

describe("discordMarkupToPlainText / discordTextToPlainText", () => {
  it("flattens every token kind to plain text", () => {
    const text =
      "Now tag <@&815277786012975134> in <#1099323056012394556>, hi <@123456789012345678>, nice <:pizza:1234826199080112138>, see [the treasury](https://treasury.pizzadao.xyz), ignore <t:1700000000:Z>"
    const plain = discordTextToPlainText(text, {
      roles: { "815277786012975134": "Partnerships" },
      channels: { "1099323056012394556": "partner-suggestions" },
    })
    expect(plain).toBe(
      "Now tag @Partnerships in #partner-suggestions, hi @user, nice :pizza:, see the treasury, ignore ",
    )
  })

  it("flattens a valid Discord timestamp to the same formatted string formatDiscordTimestamp produces", () => {
    const tokens = parseDiscordMarkup("<t:1700000000:D>")
    expect(discordMarkupToPlainText(tokens)).toBe(formatDiscordTimestamp(1700000000, "D"))
  })

  describe("keepTimestamps", () => {
    it("re-serializes a timestamp token back to its original <t:unix:style> tag instead of formatting it", () => {
      const tokens = parseDiscordMarkup("due <t:1700000000:R> soon")
      expect(discordMarkupToPlainText(tokens, {}, { keepTimestamps: true })).toBe("due <t:1700000000:R> soon")
    })

    it("re-serializes a no-style timestamp back to its original <t:unix> tag (no style suffix added)", () => {
      expect(discordTextToPlainText("due <t:1700000000>", {}, { keepTimestamps: true })).toBe("due <t:1700000000>")
    })

    it("still resolves channels/roles to plain text while keeping the timestamp raw", () => {
      const plain = discordTextToPlainText(
        "meet in <#1099323056012394556> at <t:1700000000:t>",
        { channels: { "1099323056012394556": "partner-suggestions" } },
        { keepTimestamps: true },
      )
      expect(plain).toBe("meet in #partner-suggestions at <t:1700000000:t>")
    })

    it("still drops a malformed timestamp tag even with keepTimestamps set", () => {
      expect(discordTextToPlainText("due <t:123:Z>", {}, { keepTimestamps: true })).toBe("due ")
    })
  })

  it("falls back to the maps argument when a token wasn't resolved at parse time", () => {
    const tokens = parseDiscordMarkup("<#1099323056012394556>")
    expect(tokens).toEqual([{ type: "channel", id: "1099323056012394556", name: null }])
    expect(
      discordMarkupToPlainText(tokens, { channels: { "1099323056012394556": "partner-suggestions" } }),
    ).toBe("#partner-suggestions")
  })

  it("falls back to a generic label when nothing resolves", () => {
    expect(discordTextToPlainText("<#1099323056012394556> <@&815277786012975134>")).toBe(
      "#channel @role",
    )
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

describe("formatDiscordTimestamp", () => {
  const UNIX = 1700000000 // 2023-11-14T22:13:20.000Z

  it("defaults to style f when none is given", () => {
    expect(formatDiscordTimestamp(UNIX)).toBe(formatDiscordTimestamp(UNIX, "f"))
  })

  it("formats every absolute style as a non-empty string, date-bearing styles including the year", () => {
    for (const style of ["t", "T", "d", "D", "f", "F"] as const) {
      const formatted = formatDiscordTimestamp(UNIX, style)
      expect(formatted.length).toBeGreaterThan(0)
    }
    for (const style of ["d", "D", "f", "F"] as const) {
      expect(formatDiscordTimestamp(UNIX, style)).toMatch(/2023/)
    }
  })

  it("formats a relative (R) timestamp relative to the given `now`, past and future", () => {
    expect(formatDiscordTimestamp(UNIX, "R", (UNIX + 3600) * 1000)).toBe("1 hour ago")
    expect(formatDiscordTimestamp(UNIX, "R", (UNIX - 3600) * 1000)).toBe("in 1 hour")
  })

  it("picks the right relative unit across magnitudes", () => {
    expect(formatDiscordTimestamp(UNIX, "R", UNIX * 1000)).toBe("now")
    expect(formatDiscordTimestamp(UNIX, "R", (UNIX + 45) * 1000)).toBe("45 seconds ago")
    expect(formatDiscordTimestamp(UNIX, "R", (UNIX + 3 * 86400) * 1000)).toBe("3 days ago")
  })
})
