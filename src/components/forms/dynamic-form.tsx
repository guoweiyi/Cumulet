"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Minus, Plus } from "lucide-react";
import {
  evaluateVisibility,
  pick,
  type Field,
  type FormDefinition,
  type FormValues,
} from "@/lib/form-engine";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

/**
 * Renders a form definition. Visibility (incl. nested chains) is recomputed on
 * every render from the current values via the shared engine — the renderer is
 * a pure projection of definition + values.
 */
export function DynamicForm({
  definition,
  values,
  onChange,
  errors = {},
  disabled,
  localeOverride,
}: {
  definition: FormDefinition;
  values: FormValues;
  onChange: (id: string, value: unknown) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
  localeOverride?: string;
}) {
  const activeLocale = useLocale();
  const locale = localeOverride ?? activeLocale;
  const t = useTranslations("formEngine.errors");
  const visible = evaluateVisibility(definition, values);
  const shown = definition.fields.filter((f) => visible.has(f.id));

  return (
    <div className="space-y-5">
      {shown.map((f) => {
        const error = errors[f.id];
        return (
          <div key={f.id} className="space-y-1.5">
            {f.type !== "toggle" && (
              <Label className="gap-1">
                {pick(f.label, locale)}
                {f.required && <span className="text-destructive">*</span>}
              </Label>
            )}
            <FieldControl f={f} values={values} onChange={onChange} disabled={disabled} locale={locale} />
            {f.hint && <p className="text-xs text-muted-foreground">{pick(f.hint, locale)}</p>}
            {error && <p className="text-xs text-destructive">{t(error)}</p>}
          </div>
        );
      })}
    </div>
  );
}

function FieldControl({
  f,
  values,
  onChange,
  disabled,
  locale,
}: {
  f: Field;
  values: FormValues;
  onChange: (id: string, value: unknown) => void;
  disabled?: boolean;
  locale: string;
}) {
  const v = values[f.id];
  const p = f.props ?? {};

  switch (f.type) {
    case "text": {
      const hasAffix = p.prefix || p.suffix;
      const input = (
        <Input
          value={typeof v === "string" ? v : ""}
          maxLength={1000}
          disabled={disabled}
          className={cn(hasAffix && "rounded-none border-0 shadow-none focus-visible:ring-0")}
          onChange={(e) => onChange(f.id, e.target.value)}
        />
      );
      if (!hasAffix) return input;
      // Prefix/suffix rendered as fixed adornments inside a bordered shell.
      return (
        <div className="flex max-w-lg items-stretch overflow-hidden rounded-md border focus-within:ring-2 focus-within:ring-ring">
          {p.prefix && (
            <span className="flex items-center whitespace-nowrap bg-secondary px-2.5 text-sm text-muted-foreground">
              {p.prefix}
            </span>
          )}
          <div className="flex-1">{input}</div>
          {p.suffix && (
            <span className="flex items-center whitespace-nowrap bg-secondary px-2.5 text-sm text-muted-foreground">
              {p.suffix}
            </span>
          )}
        </div>
      );
    }

    case "dropdown":
      return (
        <Select
          value={typeof v === "string" ? v : undefined}
          disabled={disabled}
          onValueChange={(val) => onChange(f.id, val)}
        >
          <SelectTrigger className="w-full max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(p.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {pick(o.label, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "radio_card":
      return (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {(p.options ?? []).map((o) => {
            const active = v === o.value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange(f.id, o.value)}
                className={cn(
                  "relative rounded-lg border px-3 py-3 text-left text-sm transition-colors",
                  active
                    ? "border-brand bg-brand-soft font-medium text-brand-strong"
                    : "border-border bg-card hover:border-brand/40",
                )}
              >
                {pick(o.label, locale)}
                {active && (
                  <span className="absolute -right-px -top-px flex size-5 items-center justify-center rounded-bl-lg rounded-tr-lg bg-brand text-brand-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      );

    case "stepper": {
      const min = p.min ?? 0;
      const max = p.max ?? 9999;
      const step = p.step ?? 1;
      const n = typeof v === "number" ? v : Number(v ?? min);
      return (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            disabled={disabled || n <= min}
            onClick={() => onChange(f.id, Math.max(min, n - step))}
          >
            <Minus className="size-3.5" />
          </Button>
          <span className="tnum w-16 text-center text-sm font-medium">
            {n}
            {p.unit && <span className="ml-0.5 text-xs text-muted-foreground">{pick(p.unit, locale)}</span>}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            disabled={disabled || n >= max}
            onClick={() => onChange(f.id, Math.min(max, n + step))}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      );
    }

    case "slider": {
      const min = p.min ?? 0;
      const n = typeof v === "number" ? v : Number(v ?? min);
      return (
        <div className="flex max-w-md items-center gap-4">
          <Slider
            value={[n]}
            min={min}
            max={p.max ?? 100}
            step={p.step ?? 1}
            disabled={disabled}
            onValueChange={([val]) => onChange(f.id, val)}
            className="flex-1"
          />
          <span className="tnum w-16 text-right text-sm font-medium">
            {n}
            {p.unit && <span className="ml-0.5 text-xs text-muted-foreground">{pick(p.unit, locale)}</span>}
          </span>
        </div>
      );
    }

    case "toggle":
      return (
        <label className="flex items-center gap-3">
          <Switch
            checked={v === true}
            disabled={disabled}
            onCheckedChange={(val) => onChange(f.id, val)}
          />
          <span className="text-sm">
            {pick(f.label, locale)}
            {f.required && <span className="ml-1 text-destructive">*</span>}
          </span>
        </label>
      );
  }
}
