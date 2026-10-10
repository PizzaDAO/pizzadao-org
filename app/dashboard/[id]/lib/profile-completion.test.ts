import { describe, expect, it } from "vitest";
import { getProfileCompletion, OPTIONAL_CONNECTIONS } from "./profile-completion";

describe("community setup", () => {
  it("offers joining a crew to a newcomer", () => {
    const result = getProfileCompletion({ member: { id: "42", crews: [] }, wallets: { count: 0 }, x: { connected: false } });
    expect(result).toMatchObject({ total: 1, completed: 0, isComplete: false, next: { key: "join_crew", href: "/crews" } });
  });
  it("does not require external accounts to complete community setup", () => {
    const result = getProfileCompletion({ member: { id: "42", crews: ["tech"] }, wallets: { count: 0 }, x: { connected: false } });
    expect(result).toMatchObject({ percent: 100, isComplete: true, next: null });
    expect(OPTIONAL_CONNECTIONS.map(s => s.key)).toEqual(["connect_wallet", "connect_x"]);
  });
});
