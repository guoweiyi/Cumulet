"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Languages, Plus, Rocket, Save, Trash2 } from "lucide-react";
import {
  defaultValues,
  pick,
  type Condition,
  type Field,
  type FieldType,
  type FormDefinition,
  type FormValues,
  type Operator,
} from "@/lib/form-engine";
import { cn } from "@/lib/utils";
import { DynamicForm } from "./dynamic-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const FIELD_TYPES: FieldType[] = ["text", "dropdown", "radio_card", "stepper", "slider", "toggle"];
const OPERATORS: Operator[] = ["equals", "notEquals", "isTrue", "isFalse", "in"];

type BuilderField = Field & { _uid: string };

// --- condition normalization (single | one-level all/any of leaves) ---------
type CondMode = "always" | "single" | "all" | "any";
type Leaf = { field: string; operator: Operator; value?: string };

function toEditable(c: Condition | undefined): { mode: CondMode; leaves: Leaf[] } {
  if (!c) return { mode: "always", leaves: [] };
  if ("all" in c) return { mode: "all", leaves: c.all.filter(isLeaf).map(leafOf) };
  if ("any" in c) return { mode: "any", leaves: c.any.filter(isLeaf).map(leafOf) };
  return { mode: "single", leaves: [leafOf(c)] };
}
function isLeaf(c: Condition): c is { field: string; operator: Operator; value?: unknown } {
  return "field" in c;
}
function leafOf(c: { field: string; operator: Operator; value?: unknown }): Leaf {
  return { field: c.field, operator: c.operator, value: c.value === undefined ? undefined : String(c.value) };
}
function fromEditable(mode: CondMode, leaves: Leaf[]): Condition | undefined {
  const build = (l: Leaf): Condition => {
    if (l.operator === "isTrue" || l.operator === "isFalse") return { field: l.field, operator: l.operator };
    if (l.operator === "in") {
      return { field: l.field, operator: "in", value: (l.value ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
    }
    return { field: l.field, operator: l.operator, value: l.value ?? "" };
  };
  if (mode === "always" || leaves.length === 0) return undefined;
  if (mode === "single") return build(leaves[0]);
  return mode === "all" ? { all: leaves.map(build) } : { any: leaves.map(build) };
}

export function FormBuilder({
  schemaId,
  initialDefinition,
  editable,
  version,
  status,
}: {
  schemaId: string;
  initialDefinition: FormDefinition;
  editable: boolean;
  version: number;
  status: string;
}) {
  const t = useTranslations("formEngine.builder");
  const tt = useTranslations("formEngine.types");
  const tf = useTranslations("admin.form");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [meta, setMeta] = useState(initialDefinition.meta);
  const [fields, setFields] = useState<BuilderField[]>(
    initialDefinition.fields.map((f) => ({ ...f, _uid: crypto.randomUUID() })),
  );
  const [openUid, setOpenUid] = useState<string | null>(null);
  const [previewLocale, setPreviewLocale] = useState(locale);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const definition = useMemo<FormDefinition>(
    () => ({
      formatVersion: 1,
      meta,
      fields: fields.map(({ _uid, ...field }) => {
        void _uid;
        return stripEmpty(field);
      }),
    }),
    [meta, fields],
  );
  const [previewValues, setPreviewValues] = useState<FormValues>(() => defaultValues(initialDefinition));

  function patchField(uid: string, patch: Partial<BuilderField>) {
    setFields((fs) => fs.map((f) => (f._uid === uid ? { ...f, ...patch } : f)));
  }

  function addField(type: FieldType) {
    // Collision-free id: `field_${n}` incremented past any existing id, so
    // deleting then adding fields never produces a duplicate id.
    const existing = new Set(fields.map((f) => f.id));
    let n = fields.length + 1;
    while (existing.has(`field_${n}`)) n++;
    const f: BuilderField = {
      _uid: crypto.randomUUID(),
      id: `field_${n}`,
      type,
      label: { zh: `字段 ${n}`, en: `Field ${n}` },
      required: false,
      ...(type === "dropdown" || type === "radio_card"
        ? { props: { options: [{ value: "option1", label: { zh: "选项 1", en: "Option 1" } }] } }
        : {}),
      ...(type === "slider" || type === "stepper" ? { props: { min: 1, max: 10, step: 1 } } : {}),
    };
    setFields([...fields, f]);
    setOpenUid(f._uid);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setFields((fs) => {
      const from = fs.findIndex((f) => f._uid === active.id);
      const to = fs.findIndex((f) => f._uid === over.id);
      return arrayMove(fs, from, to);
    });
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/forms/${schemaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      if (res.status === 422) {
        const data = await res.json().catch(() => null);
        const msg = data?.error?.issues?.[0]?.message ?? tc("saveFailed");
        toast.error(msg);
        return false;
      }
      if (!res.ok) {
        toast.error(tc("saveFailed"));
        return false;
      }
      toast.success(tc("saveSuccess"));
      return true;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!(await save())) return;
    const res = await fetch(`/api/admin/forms/${schemaId}/publish`, { method: "POST" });
    if (!res.ok) {
      toast.error(tc("requestFailed"));
      return;
    }
    toast.success(tc("saveSuccess"));
    setPublishOpen(false);
    router.push("/admin/forms");
    router.refresh();
  }

  const otherFields = (uid: string) => fields.filter((f) => f._uid !== uid);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_440px]">
      {/* Left: builder */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Input
              value={meta.name.zh}
              disabled={!editable}
              onChange={(e) => setMeta({ ...meta, name: { ...meta.name, zh: e.target.value } })}
              placeholder={t("formName") + " (zh)"}
            />
            <Input
              value={meta.name.en ?? ""}
              disabled={!editable}
              onChange={(e) => setMeta({ ...meta, name: { ...meta.name, en: e.target.value } })}
              placeholder={t("formName") + " (en)"}
            />
          </div>
          <Badge variant="secondary">
            {tf("version", { n: version })} · {tf(`statusLabel.${status}` as never)}
          </Badge>
          {editable && (
            <>
              <Button variant="outline" disabled={saving} onClick={save}>
                <Save className="size-4" /> {tc("save")}
              </Button>
              <Button disabled={saving} onClick={() => setPublishOpen(true)}>
                <Rocket className="size-4" /> {tf("publish")}
              </Button>
            </>
          )}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={fields.map((f) => f._uid)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {fields.map((f) => (
                <FieldBlock
                  key={f._uid}
                  field={f}
                  otherFields={otherFields(f._uid)}
                  open={openUid === f._uid}
                  editable={editable}
                  onToggle={() => setOpenUid(openUid === f._uid ? null : f._uid)}
                  onPatch={(patch) => patchField(f._uid, patch)}
                  onRemove={() => setFields((fs) => fs.filter((x) => x._uid !== f._uid))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {editable && (
          <div className="flex flex-wrap gap-2">
            {FIELD_TYPES.map((type) => (
              <Button key={type} variant="outline" size="sm" onClick={() => addField(type)}>
                <Plus className="size-3.5" /> {tt(type)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Right: live preview */}
      <Card className="h-fit shadow-card xl:sticky xl:top-16">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-sm text-muted-foreground">{t("livePreview")}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setPreviewLocale(previewLocale === "zh" ? "en" : "zh")}
          >
            <Languages className="size-4" /> {previewLocale === "zh" ? t("previewZh") : t("previewEn")}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-base font-semibold">{pick(meta.name, previewLocale)}</p>
          <DynamicForm
            definition={definition}
            values={previewValues}
            localeOverride={previewLocale}
            onChange={(k, v) => setPreviewValues((pv) => ({ ...pv, [k]: v }))}
          />
        </CardContent>
      </Card>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tf("publish")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{tf("publishConfirm")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={publish}>{tc("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FieldBlock({
  field,
  otherFields,
  open,
  editable,
  onToggle,
  onPatch,
  onRemove,
}: {
  field: BuilderField;
  otherFields: BuilderField[];
  open: boolean;
  editable: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<BuilderField>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("formEngine.builder");
  const tt = useTranslations("formEngine.types");
  const locale = useLocale();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field._uid,
    disabled: !editable,
  });

  const hasOptions = field.type === "dropdown" || field.type === "radio_card";
  const hasRange = field.type === "slider" || field.type === "stepper";
  const p = field.props ?? {};

  function patchProps(patch: Partial<NonNullable<Field["props"]>>) {
    onPatch({ props: { ...p, ...patch } });
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-lg border bg-card", isDragging && "opacity-60 shadow-card-hover")}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {editable && (
          <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground">
            <GripVertical className="size-4" />
          </button>
        )}
        <span className="text-sm font-medium">{pick(field.label, locale)}</span>
        <Badge variant="outline" className="text-[10px]">
          {tt(field.type)}
        </Badge>
        {field.required && <span className="text-xs text-destructive">*</span>}
        {field.visibleWhen && (
          <Badge variant="secondary" className="text-[10px]">
            {t("condition")}
          </Badge>
        )}
        <div className="flex-1" />
        <code className="text-[10px] text-muted-foreground/60">{field.id}</code>
        {editable && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground/50 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(t("deleteFieldConfirm"))) onRemove();
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="size-7" onClick={onToggle}>
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
      </div>

      {open && (
        <div className="space-y-4 border-t bg-secondary/30 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Prop label={t("id")}>
              <Input
                value={field.id}
                disabled={!editable}
                onChange={(e) => onPatch({ id: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
              />
            </Prop>
            <Prop label={t("type")}>
              <Select
                value={field.type}
                disabled={!editable}
                onValueChange={(v) => onPatch({ type: v as FieldType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((ty) => (
                    <SelectItem key={ty} value={ty}>{tt(ty)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
            <Prop label={t("labelZh")}>
              <Input value={field.label.zh} disabled={!editable} onChange={(e) => onPatch({ label: { ...field.label, zh: e.target.value } })} />
            </Prop>
            <Prop label={t("labelEn")}>
              <Input value={field.label.en ?? ""} disabled={!editable} onChange={(e) => onPatch({ label: { ...field.label, en: e.target.value } })} />
            </Prop>
            <Prop label={t("hintZh")}>
              <Input
                value={field.hint?.zh ?? ""}
                disabled={!editable}
                onChange={(e) => onPatch({ hint: e.target.value || field.hint?.en ? { zh: e.target.value, en: field.hint?.en } : undefined })}
              />
            </Prop>
            <Prop label={t("hintEn")}>
              <Input
                value={field.hint?.en ?? ""}
                disabled={!editable}
                onChange={(e) => onPatch({ hint: { zh: field.hint?.zh ?? "", en: e.target.value } })}
              />
            </Prop>
            <Prop label={t("required")}>
              <div className="flex h-9 items-center">
                <Checkbox checked={field.required} disabled={!editable} onCheckedChange={(v) => onPatch({ required: v === true })} />
              </div>
            </Prop>
            {field.type === "text" && (
              <>
                <Prop label={t("prefix")}>
                  <Input value={p.prefix ?? ""} disabled={!editable} onChange={(e) => patchProps({ prefix: e.target.value || undefined })} />
                </Prop>
                <Prop label={t("suffix")}>
                  <Input value={p.suffix ?? ""} disabled={!editable} onChange={(e) => patchProps({ suffix: e.target.value || undefined })} />
                </Prop>
              </>
            )}
            {hasRange && (
              <>
                <Prop label={t("min")}>
                  <Input type="number" value={p.min ?? 0} disabled={!editable} onChange={(e) => patchProps({ min: Number(e.target.value) })} />
                </Prop>
                <Prop label={t("max")}>
                  <Input type="number" value={p.max ?? 0} disabled={!editable} onChange={(e) => patchProps({ max: Number(e.target.value) })} />
                </Prop>
                <Prop label={t("step")}>
                  <Input type="number" value={p.step ?? 1} disabled={!editable} onChange={(e) => patchProps({ step: Math.max(1, Number(e.target.value)) })} />
                </Prop>
                <Prop label={t("unitZh")}>
                  <Input value={p.unit?.zh ?? ""} disabled={!editable} onChange={(e) => patchProps({ unit: { zh: e.target.value, en: p.unit?.en } })} />
                </Prop>
                <Prop label={t("unitEn")}>
                  <Input value={p.unit?.en ?? ""} disabled={!editable} onChange={(e) => patchProps({ unit: { zh: p.unit?.zh ?? "", en: e.target.value } })} />
                </Prop>
                <Prop label={t("defaultValue")}>
                  <Input
                    type="number"
                    value={typeof field.defaultValue === "number" ? field.defaultValue : ""}
                    disabled={!editable}
                    onChange={(e) => onPatch({ defaultValue: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </Prop>
              </>
            )}
          </div>

          {hasOptions && (
            <OptionsEditor field={field} editable={editable} onPatch={patchProps} />
          )}

          <ConditionEditor field={field} otherFields={otherFields} editable={editable} onPatch={onPatch} />
        </div>
      )}
    </div>
  );
}

function OptionsEditor({
  field,
  editable,
  onPatch,
}: {
  field: BuilderField;
  editable: boolean;
  onPatch: (patch: Partial<NonNullable<Field["props"]>>) => void;
}) {
  const t = useTranslations("formEngine.builder");
  const options = field.props?.options ?? [];
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{t("options")}</Label>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input className="w-32" placeholder={t("optionValue")} value={o.value} disabled={!editable}
            onChange={(e) => onPatch({ options: options.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
          <Input placeholder={t("optionLabelZh")} value={o.label.zh} disabled={!editable}
            onChange={(e) => onPatch({ options: options.map((x, j) => (j === i ? { ...x, label: { ...x.label, zh: e.target.value } } : x)) })} />
          <Input placeholder={t("optionLabelEn")} value={o.label.en ?? ""} disabled={!editable}
            onChange={(e) => onPatch({ options: options.map((x, j) => (j === i ? { ...x, label: { ...x.label, en: e.target.value } } : x)) })} />
          {editable && (
            <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground/50"
              onClick={() => onPatch({ options: options.filter((_, j) => j !== i) })}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {editable && (
        <Button variant="outline" size="sm"
          onClick={() => onPatch({ options: [...options, { value: `option${options.length + 1}`, label: { zh: `选项 ${options.length + 1}` } }] })}>
          <Plus className="size-3.5" /> {t("addOption")}
        </Button>
      )}
    </div>
  );
}

function ConditionEditor({
  field,
  otherFields,
  editable,
  onPatch,
}: {
  field: BuilderField;
  otherFields: BuilderField[];
  editable: boolean;
  onPatch: (patch: Partial<BuilderField>) => void;
}) {
  const t = useTranslations("formEngine.builder");
  const locale = useLocale();
  const { mode, leaves } = toEditable(field.visibleWhen);

  function apply(nextMode: CondMode, nextLeaves: Leaf[]) {
    onPatch({ visibleWhen: fromEditable(nextMode, nextLeaves) });
  }

  function setLeaf(i: number, patch: Partial<Leaf>) {
    apply(mode, leaves.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  const refField = (id: string) => otherFields.find((f) => f.id === id);

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <Label className="text-xs text-muted-foreground">{t("condition")}</Label>
      <Select
        value={mode}
        disabled={!editable}
        onValueChange={(v) => {
          const m = v as CondMode;
          if (m === "always") apply("always", []);
          else if (leaves.length === 0) apply(m, [{ field: otherFields[0]?.id ?? "", operator: "equals", value: "" }]);
          else apply(m, m === "single" ? [leaves[0]] : leaves);
        }}
      >
        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="always">{t("always")}</SelectItem>
          <SelectItem value="single">{t("single")}</SelectItem>
          <SelectItem value="all">{t("all")}</SelectItem>
          <SelectItem value="any">{t("any")}</SelectItem>
        </SelectContent>
      </Select>

      {mode !== "always" && (
        <div className="space-y-2">
          {leaves.map((leaf, i) => {
            const ref = refField(leaf.field);
            const noValue = leaf.operator === "isTrue" || leaf.operator === "isFalse";
            return (
              <div key={i} className="flex flex-wrap items-center gap-1.5">
                <Select value={leaf.field} disabled={!editable} onValueChange={(v) => setLeaf(i, { field: v })}>
                  <SelectTrigger className="w-40"><SelectValue placeholder={t("conditionField")} /></SelectTrigger>
                  <SelectContent>
                    {otherFields.map((f) => (
                      <SelectItem key={f._uid} value={f.id}>{pick(f.label, locale)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={leaf.operator} disabled={!editable} onValueChange={(v) => setLeaf(i, { operator: v as Operator })}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((op) => (
                      <SelectItem key={op} value={op}>{t(`op.${op}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!noValue &&
                  (ref?.props?.options ? (
                    <Select value={leaf.value ?? ""} disabled={!editable} onValueChange={(v) => setLeaf(i, { value: v })}>
                      <SelectTrigger className="w-36"><SelectValue placeholder={t("conditionValue")} /></SelectTrigger>
                      <SelectContent>
                        {ref.props.options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{pick(o.label, locale)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input className="w-36" placeholder={t("conditionValue")} value={leaf.value ?? ""} disabled={!editable}
                      onChange={(e) => setLeaf(i, { value: e.target.value })} />
                  ))}
                {editable && (mode === "all" || mode === "any") && (
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground/50"
                    onClick={() => apply(mode, leaves.filter((_, j) => j !== i))}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
          {editable && (mode === "all" || mode === "any") && (
            <Button variant="outline" size="sm"
              onClick={() => apply(mode, [...leaves, { field: otherFields[0]?.id ?? "", operator: "equals", value: "" }])}>
              <Plus className="size-3.5" /> {t("addCondition")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Drop empty optional props so the stored JSON stays clean. */
function stripEmpty(f: Field): Field {
  const out: Field = { ...f };
  if (out.props) {
    const p = { ...out.props };
    if (p.options && p.options.length === 0) delete p.options;
    if (p.unit && !p.unit.zh && !p.unit.en) delete p.unit;
    if (p.prefix === "") delete p.prefix;
    if (p.suffix === "") delete p.suffix;
    if (Object.keys(p).length === 0) delete out.props;
    else out.props = p;
  }
  if (out.hint && !out.hint.zh && !out.hint.en) delete out.hint;
  return out;
}
