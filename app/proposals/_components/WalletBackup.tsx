"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { backupMessage, decryptBallot, encryptBallot } from "@/app/lib/proposals/backup";
import type { Ballot } from "@/app/lib/proposals/client";
import { Web3Providers } from "@/app/lib/web3-providers";

type Props = { proposalId: string; ballot: Ballot | null; onRestored: (b: Ballot) => void };

function Inner({ proposalId, ballot, onRestored }: Props) {
    const t = useTranslations("proposals.vote");
    const { isConnected } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState("");
    const [warn, setWarn] = useState("");

    // The signature is computed here, in the browser, and only ever used to derive the encryption key.
    // Only the resulting ciphertext is sent to the server.
    async function backup() {
        if (!ballot) return;
        setBusy(true);
        setNote("");
        setWarn("");
        try {
            const message = backupMessage(proposalId);
            const first = await signMessageAsync({ message });
            const second = await signMessageAsync({ message });
            if (first !== second) {
                // Smart-contract wallets may sign differently each time: a backup made with this wallet could never be restored.
                setWarn(t("backupNotRepeatable"));
                return;
            }
            const blob = await encryptBallot(first, proposalId, {
                token: ballot.token,
                preparedMessage: ballot.preparedMessage,
                signature: ballot.signature,
                choice: ballot.choice,
            });
            const r = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/backup`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ blob }),
            });
            setNote(r.ok ? t("backupDone") : t("backupFailed"));
        } catch {
            setNote(t("backupFailed"));
        } finally {
            setBusy(false);
        }
    }

    async function restore() {
        setBusy(true);
        setNote("");
        setWarn("");
        try {
            const r = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/backup`, { cache: "no-store" });
            const body = r.ok ? await r.json() : null;
            if (!body?.blob) {
                setNote(t("restoreNone"));
                return;
            }
            const sig = await signMessageAsync({ message: backupMessage(proposalId) });
            const p = await decryptBallot(sig, proposalId, body.blob);
            if (!p) {
                setNote(t("restoreWrongWallet"));
                return;
            }
            onRestored({ token: p.token, preparedMessage: p.preparedMessage, signature: p.signature, choice: p.choice });
            setNote(t("restoreDone"));
        } catch {
            setNote(t("restoreFailed"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="grid gap-2 rounded border p-3 text-sm">
            <p className="m-0">{t("backupHelp")}</p>
            <ConnectButton showBalance={false} />
            {isConnected && (
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={backup} disabled={busy || !ballot} className="min-h-11 rounded bg-foreground px-4 text-background disabled:opacity-50">
                        {t("backupNow")}
                    </button>
                    <button type="button" onClick={restore} disabled={busy} className="min-h-11 rounded border px-4 disabled:opacity-50">
                        {t("restoreNow")}
                    </button>
                </div>
            )}
            {warn && (
                <p role="alert" className="m-0 text-tomato">
                    {warn}
                </p>
            )}
            {note && (
                <p role="status" className="m-0">
                    {note}
                </p>
            )}
        </div>
    );
}

export function WalletBackup(props: Props) {
    return (
        <Web3Providers>
            <Inner {...props} />
        </Web3Providers>
    );
}
