import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiscordText } from "./DiscordText";
import { formatDiscordTimestamp } from "@/app/lib/discord-markup";

describe("DiscordText", () => {
  it("renders plain text unchanged", () => {
    render(<DiscordText text="Share a pizza photo" />);
    expect(screen.getByText("Share a pizza photo")).toBeInTheDocument();
  });

  it("renders a channel mention as a linked #name, falling back to #channel when unresolved", () => {
    const { rerender } = render(
      <DiscordText text="in <#1099323056012394556>" channels={{ "1099323056012394556": "partner-suggestions" }} guildId="999" />,
    );
    const link = screen.getByRole("link", { name: "#partner-suggestions" });
    expect(link).toHaveAttribute("href", "https://discord.com/channels/999/1099323056012394556");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Keeps working inside a `pointer-events: none` stretched-button
    // ancestor (see JobCard) by re-enabling pointer events on itself.
    expect(link).toHaveStyle({ pointerEvents: "auto" });

    rerender(<DiscordText text="in <#1099323056012394556>" guildId="999" />);
    const fallbackLink = screen.getByRole("link", { name: "#channel" });
    expect(fallbackLink).toHaveAttribute("href", "https://discord.com/channels/999/1099323056012394556");
  });

  it("renders a channel mention as plain text (not a link) when there is no guild id", () => {
    const { container } = render(
      <DiscordText text="in <#1099323056012394556>" channels={{ "1099323056012394556": "treasury" }} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("in #treasury");
  });

  it("renders a role mention as a non-link pill, falling back to @role when unresolved", () => {
    render(<DiscordText text="tag <@&815277786012975134>" roles={{ "815277786012975134": "Partnerships" }} />);
    expect(screen.getByText("@Partnerships")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();

    render(<DiscordText text="tag <@&000009999999999>" />);
    expect(screen.getByText("@role")).toBeInTheDocument();
  });

  it("renders a user mention as plain @user", () => {
    render(<DiscordText text="hi <@123456789012345678>" />);
    expect(screen.getByText("@user")).toBeInTheDocument();
  });

  it("renders a markdown link as a new-tab anchor", () => {
    render(<DiscordText text="see [the treasury](https://treasury.pizzadao.xyz)" />);
    const link = screen.getByRole("link", { name: "the treasury" });
    expect(link).toHaveAttribute("href", "https://treasury.pizzadao.xyz");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders a custom emoji as an image and hides it entirely on load error", () => {
    render(<DiscordText text="nice <:frankpepe_trade:1234826199080112138>" />);
    const img = screen.getByRole("img", { name: ":frankpepe_trade:" });
    expect(img).toHaveAttribute("src", "https://cdn.discordapp.com/emojis/1234826199080112138.png");

    fireEvent.error(img);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(":frankpepe_trade:")).toBeNull();
  });

  it("uses the .gif extension for animated emoji", () => {
    render(<DiscordText text="<a:frankpepe_trade:1234826199080112138>" />);
    const img = screen.getByRole("img", { name: ":frankpepe_trade:" });
    expect(img).toHaveAttribute("src", "https://cdn.discordapp.com/emojis/1234826199080112138.gif");
  });

  it("strips unrecognized Discord-shaped tags instead of showing them raw", () => {
    // A timestamp tag with an invalid style letter is malformed, not a
    // valid <t:...> form — still stripped as "unknown" (see the
    // "renders Discord timestamps" block below for valid forms).
    render(<DiscordText text="due <t:1700000000:Z> soon" />);
    expect(screen.getByText(/due/)).toBeInTheDocument();
    expect(screen.getByText(/soon/)).toBeInTheDocument();
    expect(screen.queryByText(/<t:/)).toBeNull();
  });

  describe("renders Discord timestamps", () => {
    it("renders <t:UNIX> (default style f) in a <time> element with a dateTime attribute", () => {
      render(<DiscordText text="due <t:1700000000>" />);
      const time = document.querySelector("time");
      expect(time).not.toBeNull();
      expect(time).toHaveAttribute("dateTime", new Date(1700000000 * 1000).toISOString());
      // "f" style: a long date + short time — e.g. "November 14, 2023, 10:13 PM".
      expect(time?.textContent).toMatch(/2023/);
    });

    it("renders a relative <t:UNIX:R> timestamp using the same string as the plain-text helper", () => {
      render(<DiscordText text="due <t:1700000000:R>" />);
      const time = document.querySelector("time");
      expect(time).not.toBeNull();
      expect(time?.textContent).toBe(formatDiscordTimestamp(1700000000, "R"));
    });

    it("renders each absolute style without throwing and keeps the raw tag off the page", () => {
      for (const style of ["t", "T", "d", "D", "f", "F"] as const) {
        const { container, unmount } = render(<DiscordText text={`<t:1700000000:${style}>`} />);
        expect(container.querySelector("time")).not.toBeNull();
        expect(container.textContent).not.toMatch(/<t:/);
        unmount();
      }
    });
  });

  describe("interactive={false}", () => {
    it("renders a channel mention as styled text, not a link", () => {
      const { container } = render(
        <DiscordText
          text="in <#1099323056012394556>"
          channels={{ "1099323056012394556": "partner-suggestions" }}
          guildId="999"
          interactive={false}
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      expect(container.textContent).toBe("in #partner-suggestions");
    });

    it("renders a markdown link as styled text, not a link", () => {
      render(
        <DiscordText text="see [the treasury](https://treasury.pizzadao.xyz)" interactive={false} />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("the treasury")).toBeInTheDocument();
    });

    it("still renders non-link tokens (role pill, emoji) the same way", () => {
      render(
        <DiscordText
          text="tag <@&815277786012975134> <:pizza:1234826199080112138>"
          roles={{ "815277786012975134": "Partnerships" }}
          interactive={false}
        />,
      );
      expect(screen.getByText("@Partnerships")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: ":pizza:" })).toBeInTheDocument();
    });
  });
});
