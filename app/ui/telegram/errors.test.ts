import { describe, it, expect } from "vitest";
import { telegramErrorKey } from "./errors";

describe("telegramErrorKey", () => {
    it("maps known codes", () => {
        expect(telegramErrorKey("already_linked")).toBe("errAlreadyLinked");
        expect(telegramErrorKey("invalid_auth")).toBe("errInvalidLogin");
        expect(telegramErrorKey("nothing_pending")).toBe("errNothingPending");
    });
    it("falls back for unknown or missing codes", () => {
        expect(telegramErrorKey(undefined)).toBe("errLinkFailed");
        expect(telegramErrorKey("nope", "errNothingPending")).toBe("errNothingPending");
    });
});
