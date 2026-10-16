import { describe, expect, it } from "vitest";
import { sanitizeSignupDraft } from "./signup-draft";
describe("signup drafts", () => {
  it("restores only allowed profile fields and strips supplied identity and privileges", () => {
    expect(sanitizeSignupDraft({ mafiaName: 'Test Person', city: 'Paris', sessionId: 'test-session-123', discordId: 'attacker', isAdmin: true, crews: ['admin'], timezone: 'Europe/Paris' })).toEqual({ mafiaName: 'Test Person', city: 'Paris', sessionId: 'test-session-123', cityRegion: '', topping: '', timezone: 'Europe/Paris' });
  });
  it("rejects incomplete drafts and invalid correlation ids", () => {
    expect(sanitizeSignupDraft({ mafiaName: 'Test', city: 'Paris', sessionId: '<script>' })).toBeNull();
    expect(sanitizeSignupDraft({ city: 'Paris', sessionId: 'test-session' })).toBeNull();
  });
  it("drops malformed member numbers and unknown timezones", () => {
    const draft = sanitizeSignupDraft({ mafiaName: 'Test', city: 'Paris', sessionId: 'test-session', memberId: '-1', timezone: 'Unknown/Place' });
    expect(draft?.memberId).toBeUndefined(); expect(draft?.timezone).toBeUndefined();
  });
});
