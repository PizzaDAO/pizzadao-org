// Shared normalization for matching a member-sheet name against a name
// supplied by a trusted source (e.g. the signed-in session).

export function normalizeMemberName(name: unknown): string {
    return String(name ?? "").trim().toLowerCase();
}

/** True when the sheet name equals any of the candidate names after normalization. */
export function memberNameMatches(sheetName: unknown, candidates: unknown[]): boolean {
    const target = normalizeMemberName(sheetName);
    if (!target) return false;
    return candidates.some((c) => normalizeMemberName(c) === target);
}
