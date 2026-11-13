"use client";

// Ported from rsv-pizza@f04ad2a1 frontend/src/pages/TaxFormRequestPage.tsx.
// Same states and logic; chrome strings come from the "taxForm" i18n namespace.

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Lock, XCircle } from "lucide-react";
import { paperCard, pillInk, pillOutline } from "@/app/ui/shared/Editorial";
import {
  getRequest,
  saveDraft as apiSaveDraft,
  submit as apiSubmit,
  type PublicTaxFormRequest,
  type TaxFormApiError,
  type TaxFormType,
} from "./_lib/api";
import { useTaxFormEditor, type TaxFormApiAdapter } from "./_lib/useTaxFormEditor";
import { TaxFormPicker } from "./_components/TaxFormPicker";
import { W9Form, type W9FormData } from "./_components/W9Form";
import { W8BENForm, type W8BENFormData } from "./_components/W8BENForm";
import { W8BENEForm, type W8BENEFormData } from "./_components/W8BENEForm";

const FORM_TYPE_LABEL: Record<TaxFormType, string> = {
  w9: "W-9",
  w8ben: "W-8BEN",
  w8bene: "W-8BEN-E",
};

export function TaxFormClient({ token }: { token: string }) {
  const t = useTranslations("taxForm");
  const [loading, setLoading] = useState(!!token);
  const [info, setInfo] = useState<PublicTaxFormRequest | null>(null);
  const [invalid, setInvalid] = useState(!token);
  const [loadError, setLoadError] = useState<string | null>(null);

  const friendly = (e: TaxFormApiError, fallbackKey: "loadError" | "saveFailed" | "submitFailed") => {
    if (e?.code === "RATE_LIMITED") return t("rateLimited");
    if (e?.code === "NETWORK_ERROR") return t("networkError");
    return e?.message && e.status ? e.message : t(fallbackKey);
  };

  const adapter = useMemo<TaxFormApiAdapter>(
    () => ({
      saveDraft: (ft, d) =>
        apiSaveDraft(token, ft, d).catch((e) => {
          throw new Error(friendly(e, "saveFailed"));
        }),
      submit: (ft, d) =>
        apiSubmit(token, ft, d).catch((e) => {
          throw new Error(friendly(e, "submitFailed"));
        }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, t],
  );
  const editor = useTaxFormEditor(adapter);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getRequest(token)
      .then((r) => {
        if (cancelled) return;
        setInfo(r);
        if (r.currentDraft) editor.startEditing(r.currentDraft.formType, r.currentDraft.formData);
      })
      .catch((e: TaxFormApiError) => {
        if (cancelled) return;
        if (e?.code === "INVALID_TOKEN") setInvalid(true);
        else setLoadError(friendly(e, "loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className={`${paperCard} p-6 flex items-center gap-2 text-sm text-muted-foreground`}>
          <Loader2 size={16} className="animate-spin" /> {t("loading")}
        </div>
      );
    }
    if (invalid) {
      return (
        <div className={`${paperCard} p-6 flex items-start gap-3`}>
          <XCircle size={20} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-base font-semibold text-foreground">{t("invalidTitle")}</div>
            <p className="text-sm text-muted-foreground mt-1">{t("invalidBody")}</p>
          </div>
        </div>
      );
    }
    if (loadError || !info) {
      return (
        <div className={`${paperCard} p-6 flex items-start gap-3`}>
          <AlertTriangle size={20} className="text-amber-700 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-foreground">{loadError || t("loadError")}</div>
        </div>
      );
    }
    if (editor.submitted) {
      return (
        <div className={`${paperCard} p-6 flex items-start gap-3`}>
          <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="text-base font-semibold text-foreground">{t("thanks", { requester: info.requester })}</div>
        </div>
      );
    }
    if (info.locked) {
      return (
        <div className={`${paperCard} p-6 flex items-start gap-3`}>
          <Lock size={20} className="text-muted-foreground mt-0.5 flex-shrink-0" />
          <div>
            <div className="text-base font-semibold text-foreground">{t("lockedTitle")}</div>
            <p className="text-sm text-muted-foreground mt-1">
              {info.submittedFormType
                ? t("lockedBody", { requester: info.requester, form: FORM_TYPE_LABEL[info.submittedFormType] })
                : t("lockedBodyGeneric", { requester: info.requester })}
            </p>
          </div>
        </div>
      );
    }

    const ft = editor.editingType;
    return (
      <div className="space-y-4">
        {(info.status === "rejected" || info.rejectedReason !== null) && (
          <div
            role="alert"
            className={`${paperCard} p-3 border-l-4 !border-l-red-500 bg-red-500/10 text-sm text-red-800 dark:text-red-200`}
          >
            {info.rejectedReason ? t("rejectedReason", { reason: info.rejectedReason }) : t("rejected")}
          </div>
        )}
        {ft && info.storedSecretFields?.length > 0 && info.currentDraft?.formType === ft && (
          <div className={`${paperCard} p-3 border-l-4 !border-l-emerald-500 bg-emerald-500/10 text-sm text-foreground flex items-start gap-2`}>
            <Lock size={14} className="mt-0.5 flex-shrink-0" />
            <span>{t("tinOnFile")}</span>
          </div>
        )}
        {!ft ? (
          <div className={`${paperCard} p-6 space-y-3`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileText size={16} /> {t("pickerHeading")}
            </div>
            {info.suggestedFormType && (
              <p className="text-xs text-muted-foreground">
                {t("suggested", { form: FORM_TYPE_LABEL[info.suggestedFormType] })}
              </p>
            )}
            <TaxFormPicker value={info.suggestedFormType} onChange={(f) => editor.startEditing(f, null)} />
          </div>
        ) : (
          <div className={`${paperCard} p-6 space-y-4`}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">{t("formHeading", { form: FORM_TYPE_LABEL[ft] })}</div>
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={editor.stopEditing}
              >
                {t("changeForm")}
              </button>
            </div>
            {ft === "w9" ? (
              <W9Form
                value={editor.draftData as W9FormData}
                onChange={(v) => editor.setDraftData(v)}
                onSwitchFormType={(target) => editor.startEditing(target, null)}
              />
            ) : ft === "w8ben" ? (
              <W8BENForm
                value={editor.draftData as W8BENFormData}
                onChange={(v) => editor.setDraftData(v)}
                onSwitchFormType={() => editor.startEditing("w9", null)}
              />
            ) : (
              <W8BENEForm
                value={editor.draftData as W8BENEFormData}
                onChange={(v) => editor.setDraftData(v)}
                onSwitchFormType={() => editor.startEditing("w9", null)}
              />
            )}
            {editor.error && (
              <div role="alert" className={`${paperCard} p-3 border-l-4 !border-l-red-500 bg-red-500/10 text-xs text-red-800 dark:text-red-200`}>
                {editor.error}
              </div>
            )}
            {editor.statusMessage && (
              <div role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{t("draftSaved")}</div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                type="button"
                className={`${pillOutline} inline-flex items-center gap-2 justify-center`}
                onClick={editor.saveDraft}
                disabled={editor.saving || editor.submitting}
              >
                {editor.saving && <Loader2 size={14} className="animate-spin" />}
                {t("saveDraft")}
              </button>
              <button
                type="button"
                className={`${pillInk} inline-flex items-center gap-2 justify-center`}
                onClick={editor.submit}
                disabled={editor.saving || editor.submitting}
              >
                {editor.submitting && <Loader2 size={14} className="animate-spin" />}
                {t("submit")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {info && !invalid && (
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("intro", { requester: info.requester })}</p>
          <p className="text-sm text-foreground mt-1">
            {t("payee", { payee: info.payeeLabel })}
            {info.taxYearNote ? <span className="text-muted-foreground"> ({info.taxYearNote})</span> : null}
          </p>
        </div>
      )}
      {renderBody()}
    </div>
  );
}
