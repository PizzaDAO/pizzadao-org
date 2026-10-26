"use client";

// The level gates on /missions (Community Call, 2026-10-26): level 4 needs a
// vouch from another member, level 5 needs a Rare Pizza Box NFT. Missions on
// every level can be done now; this only explains what holds a member's level
// back and how to fix it, with the standing of each requirement.

import { useTranslations } from "next-intl";

export type ReqState = "not_needed" | "ok" | "grandfathered" | "missing" | "unknown";

export type LevelGateInfo = {
  vouchMinLevel: number;
  boxMinLevel: number;
  vouch: ReqState;
  box: ReqState;
  /** Their missions earn a higher level than they hold. */
  heldBack: boolean;
  earnedLevel: number;
  /** Where to get a Rare Pizza Box. */
  boxLink: string;
};

const met = (s: ReqState) => s === "ok" || s === "grandfathered";

/** Which requirement note a level's missions show: 4 -> vouch, 5+ -> box, below -> none. */
export function levelGateNoteFor(info: LevelGateInfo | undefined, level: number): "vouch" | "box" | null {
  if (!info) return null;
  if (level >= info.boxMinLevel) return "box";
  if (level >= info.vouchMinLevel) return "vouch";
  return null;
}

const boxStyle = {
  padding: "12px 14px",
  borderRadius: "var(--radius)",
  border: "1px solid hsl(var(--ink) / 0.18)",
  background: "hsl(var(--butter) / 0.35)",
  fontSize: 14,
  display: "grid",
  gap: 8,
} as const;

function Req({ kind, state, minLevel }: { kind: "vouch" | "box"; state: ReqState; minLevel: number }) {
  const t = useTranslations("levelGate");
  const status = met(state) ? "statusOk" : state === "unknown" ? "statusUnknown" : "statusMissing";
  return (
    <div data-testid={`gate-${kind}`} data-state={state}>
      <strong>{t(kind === "vouch" ? "reqVouch" : "reqBox", { level: minLevel })}</strong>
      {" · "}
      <span>{t(status)}</span>
    </div>
  );
}

/** Banner at the top of /missions, only when a requirement is holding the member's level back. */
export function LevelGateBanner({
  info,
  currentLevel,
  rechecking,
  onRecheck,
}: {
  info: LevelGateInfo;
  currentLevel: number;
  rechecking: boolean;
  onRecheck: () => void;
}) {
  const t = useTranslations("levelGate");
  if (!info.heldBack) return null;
  const vouchBlocks = info.earnedLevel >= info.vouchMinLevel && !met(info.vouch);
  const boxBlocks = info.earnedLevel >= info.boxMinLevel && !met(info.box);
  const unknown = (vouchBlocks && info.vouch === "unknown") || (boxBlocks && info.box === "unknown");
  return (
    <div role="status" data-testid="level-gate-banner" style={boxStyle}>
      <span>{t("bannerHeld", { earned: info.earnedLevel, level: currentLevel })}</span>
      <Req kind="vouch" state={info.vouch} minLevel={info.vouchMinLevel} />
      <Req kind="box" state={info.box} minLevel={info.boxMinLevel} />
      {vouchBlocks && info.vouch === "missing" && <span style={{ fontSize: 13 }}>{t("vouchHint")}</span>}
      {boxBlocks && info.box === "missing" && <span style={{ fontSize: 13 }}>{t("walletHint")}</span>}
      {unknown && <span style={{ fontSize: 13 }}>{t("unknownHint")}</span>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {boxBlocks && info.box === "missing" && info.boxLink && (
          <a href={info.boxLink} target="_blank" rel="noopener noreferrer" className="btn-pill" data-testid="gate-get-box">
            {t("getBox")}
          </a>
        )}
        <button type="button" className="btn-pill" onClick={onRecheck} disabled={rechecking} data-testid="gate-recheck">
          {rechecking ? t("rechecking") : unknown ? t("retry") : t("recheck")}
        </button>
      </div>
    </div>
  );
}

/** Inline note at the top of a gated level's missions (hidden once the requirement is met). */
export function LevelGateNote({ info, level }: { info: LevelGateInfo; level: number }) {
  const t = useTranslations("levelGate");
  const kind = levelGateNoteFor(info, level);
  if (!kind) return null;
  const state = kind === "vouch" ? info.vouch : info.box;
  if (met(state)) return null;
  return (
    <div data-testid="level-gate-note" style={{ ...boxStyle, fontSize: 13 }}>
      <Req kind={kind} state={state} minLevel={kind === "vouch" ? info.vouchMinLevel : info.boxMinLevel} />
      <span>{t("noteBody")}</span>
    </div>
  );
}
