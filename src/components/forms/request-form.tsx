"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { AgreementSettings } from "@/lib/settings";
import {
  defaultValues,
  evaluateVisibility,
  pick,
  validateSubmission,
  type FormDefinition,
  type FormValues,
} from "@/lib/form-engine";
import { DynamicForm } from "./dynamic-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function RequestForm({
  schemaId,
  definition,
  agreement,
}: {
  schemaId: string;
  definition: FormDefinition;
  agreement: AgreementSettings;
}) {
  const t = useTranslations("ticket");
  const locale = useLocale();
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => defaultValues(definition));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [agreeError, setAgreeError] = useState(false);

  // Reconcile values with visibility on every change:
  //  - drop values of fields that are now hidden (also stripped server-side), and
  //  - seed a field's default when it first becomes visible,
  // so conditional fields appear pre-filled with their defaults and stale values
  // never linger. Guarded by `changed` so it can't loop.
  useEffect(() => {
    const visible = evaluateVisibility(definition, values);
    const defaults = defaultValues(definition);
    const next: FormValues = {};
    let changed = false;
    for (const f of definition.fields) {
      if (!visible.has(f.id)) {
        if (f.id in values) changed = true; // dropping a now-hidden value
        continue;
      }
      if (f.id in values) {
        next[f.id] = values[f.id];
      } else if (f.id in defaults) {
        next[f.id] = defaults[f.id]; // seed default on reveal
        changed = true;
      }
    }
    if (changed) setValues(next);
  }, [values, definition]);

  async function submit() {
    const result = validateSubmission(definition, values);
    setErrors(result.errors);
    if (!result.ok) return;
    if (agreement.enabled && !agreed) {
      setAgreeError(true);
      return;
    }
    setAgreeError(false);
    setBusy(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaId, values: result.cleaned, agreed }),
      });
      if (res.status === 422) {
        const data = await res.json();
        if (data.error?.code === "agreement_required") {
          setAgreeError(true);
          return;
        }
        setErrors(data.error?.fields ?? {});
        return;
      }
      if (!res.ok) {
        toast.error(t("submitFailed"));
        return;
      }
      const { ticket } = await res.json();
      toast.success(t("submitted"));
      router.push(`/tickets/${ticket.id}`);
    } finally {
      setBusy(false);
    }
  }

  const visible = evaluateVisibility(definition, values);
  const labelParts = agreement.labelTemplate.split("{link}");
  const summary = definition.fields
    .filter((f) => visible.has(f.id))
    .filter((f) => {
      const v = values[f.id];
      return v !== undefined && v !== "" && v !== false && v !== null;
    })
    .slice(0, 6)
    .map((f) => {
      const v = values[f.id];
      const opt = f.props?.options?.find((o) => o.value === v);
      const label = opt ? pick(opt.label, locale) : String(v === true ? "✓" : v);
      return `${pick(f.label, locale)}: ${label}`;
    });

  return (
    <div className="mx-auto max-w-3xl pb-24">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{pick(definition.meta.name, locale)}</h1>
        {definition.meta.description && pick(definition.meta.description, locale) && (
          <p className="mt-1 text-sm text-muted-foreground">{pick(definition.meta.description, locale)}</p>
        )}
      </div>
      <Card className="shadow-card">
        <CardContent className="p-6">
          <DynamicForm
            definition={definition}
            values={values}
            errors={errors}
            onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
          />
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
          {agreement.enabled ? (
            <div className="flex flex-1 items-start gap-2 text-xs text-muted-foreground">
              <input
                id="agree-terms"
                type="checkbox"
                checked={agreed}
                onChange={(e) => {
                  setAgreed(e.target.checked);
                  if (e.target.checked) setAgreeError(false);
                }}
                className="mt-0.5 size-4 shrink-0 rounded border"
              />
              <span
                className={agreeError ? "text-red-600" : ""}
                onClick={() => setAgreed((v) => !v)}
              >
                {labelParts[0]}
                {labelParts.length > 1 && (
                  <>
                    {agreement.linkUrl ? (
                      <a
                        href={agreement.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-blue-600 underline underline-offset-2"
                      >
                        {agreement.linkText}
                      </a>
                    ) : (
                      <span className="font-medium">{agreement.linkText}</span>
                    )}
                    {labelParts[1] ?? ""}
                  </>
                )}
              </span>
            </div>
          ) : (
            <p className="flex-1 truncate text-xs text-muted-foreground">{summary.join(" · ")}</p>
          )}
          {agreeError && <p className="text-xs text-red-600 sm:hidden">{t("agreementRequired")}</p>}
          <div className="flex items-center justify-end gap-3">
            {agreeError && <p className="hidden text-xs text-red-600 sm:block">{t("agreementRequired")}</p>}
            <Button onClick={submit} disabled={busy || (agreement.enabled && !agreed)} size="lg">
              {t("newRequest")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
