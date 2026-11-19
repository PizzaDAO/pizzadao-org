import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../profile/MemberHoverCard", () => ({ MemberHoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (p: { src: string; alt: string }) => <img src={p.src} alt={p.alt} />,
}));

import AttendeeChips from "./AttendeeChips";

describe("AttendeeChips default PFP", () => {
  it("shows the default picture for an attendee without a PFP and keeps real ones", () => {
    const { container } = render(
      <AttendeeChips
        attendees={[
          { name: "Nopfp", memberId: "1", pfpUrl: null },
          { name: "Haspfp", memberId: "2", pfpUrl: "/pfp/2.jpg" },
        ]}
        label="Attendees"
        showMore={(n) => `+${n}`}
      />,
    );
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["/pfp/default.png", "/pfp/2.jpg"]);
    expect(screen.getByAltText("Default PizzaDAO profile picture")).toBeTruthy();
  });
});
