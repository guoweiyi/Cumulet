"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Plus, Rocket, Save, Trash2 } from "lucide-react";
import type { ProvisioningStepType } from "@prisma/client";
import { APPROVAL_FIELD_TYPES, DETAIL_MODULES, STEP_INPUT_SPECS, WORKFLOW_STEPS, type ApprovalField, type ApprovalFieldType, type DetailModule, type HttpRequestConfig, type StepConfig, type WorkflowDefinition } from "@/lib/workflow-definition";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function WorkflowBuilder({ schemaId, initialDefinition, requestVariableKeys, editable, version, status }: { schemaId: string; initialDefinition: WorkflowDefinition; requestVariableKeys: string[]; editable: boolean; version: number; status: string }) {
  const t = useTranslations("admin.workflow");
  const tc = useTranslations("common");
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [name, setName] = useState(initialDefinition.meta.name);
  const [resourceType, setResourceType] = useState(initialDefinition.meta.resourceType);
  const [steps, setSteps] = useState(initialDefinition.steps);
  const [stepConfigs, setStepConfigs] = useState(initialDefinition.stepConfigs);
  const [approvalFields, setApprovalFields] = useState(initialDefinition.approvalFields);
  const [modules, setModules] = useState(initialDefinition.detailModules);
  const [busy, setBusy] = useState(false);

  const definition = useMemo<WorkflowDefinition>(() => ({ formatVersion: 1, meta: { name, resourceType }, approvalFields, steps, stepConfigs, detailModules: modules }), [name, resourceType, approvalFields, steps, stepConfigs, modules]);
  const variableOptions = useMemo(() => ["system.vmid", "system.internalIp", "system.ciUser", "system.initialPassword", "system.sshKeys", "system.ipconfig", "system.nameserver", "system.configureSecurityGroup", "system.securityGroup", "system.externalAccess", "system.resourceName", "system.ownerEmail", ...requestVariableKeys.map((key) => `request.${key}`), ...approvalFields.map((field) => `approval.${field.key}`), ...Object.values(stepConfigs).flatMap((config) => config?.requests.flatMap((request) => request.captureVariable ? [`output.${request.captureVariable}`] : []) ?? [])], [approvalFields, requestVariableKeys, stepConfigs]);

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/workflows/${schemaId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition }) });
      if (!response.ok) { const data = await response.json().catch(() => null); toast.error(data?.error?.message ?? tc("saveFailed")); return false; }
      toast.success(tc("saveSuccess")); return true;
    } finally { setBusy(false); }
  }

  async function publish() {
    if (!(await save())) return;
    const response = await fetch(`/api/admin/workflows/${schemaId}/publish`, { method: "POST" });
    if (!response.ok) return toast.error(tc("requestFailed"));
    router.push("/admin/workflows"); router.refresh();
  }

  function reorder<T>(items: T[], event: DragEndEvent, idOf: (item: T) => string): T[] {
    if (!event.over || event.active.id === event.over.id) return items;
    return arrayMove(items, items.findIndex((item) => idOf(item) === event.active.id), items.findIndex((item) => idOf(item) === event.over?.id));
  }

  function addStep(step: ProvisioningStepType) {
    setSteps([...steps, step]);
    setStepConfigs({ ...stepConfigs, [step]: { timeoutSeconds: step === "DATABASE_BOOTSTRAP" ? 600 : step === "CLOUD_INIT" ? 300 : 120, failurePolicy: step === "NOTIFY" ? "SKIP" : "STOP", runBuiltIn: true, inputBindings: Object.fromEntries(STEP_INPUT_SPECS[step].map((input) => [input.key, input.defaultBinding])), requests: [] } });
  }

  function addApprovalField() {
    const used = new Set(approvalFields.map((field) => field.key));
    let index = approvalFields.length + 1;
    while (used.has(`variable${index}`)) index++;
    setApprovalFields([...approvalFields, { key: `variable${index}`, label: { zh: `审批变量 ${index}`, en: `Approval variable ${index}` }, type: "text", required: false, sensitive: false, exposeToOwner: false }]);
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3"><div className="grid flex-1 gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>{t("name")}</Label><Input disabled={!editable} value={name.zh} onChange={(event) => setName({ ...name, zh: event.target.value })} /></div><div className="space-y-1.5"><Label>{t("resourceType")}</Label><Input disabled={!editable} value={resourceType} onChange={(event) => setResourceType(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} /></div></div><span className="pb-2 text-xs text-muted-foreground">v{version} · {status}</span>{editable && <><Button variant="outline" disabled={busy} onClick={save}><Save className="size-4" />{tc("save")}</Button><Button disabled={busy} onClick={publish}><Rocket className="size-4" />{t("publish")}</Button></>}</div>

      <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">{t("approvalVariables")}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{t("approvalVariablesHint")}</p></div>{editable && <Button size="sm" variant="outline" onClick={addApprovalField}><Plus className="size-4" />{t("addVariable")}</Button>}</CardHeader><CardContent><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => setApprovalFields(reorder(approvalFields, event, (field) => field.key))}><SortableContext items={approvalFields.map((field) => field.key)} strategy={verticalListSortingStrategy}><div className="space-y-2">{approvalFields.map((field, index) => <ApprovalFieldRow key={`approval-${index}`} field={field} editable={editable} onChange={(next) => setApprovalFields(approvalFields.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => setApprovalFields(approvalFields.filter((_, itemIndex) => itemIndex !== index))} />)}{approvalFields.length === 0 && <p className="py-5 text-center text-sm text-muted-foreground">{t("noVariables")}</p>}</div></SortableContext></DndContext></CardContent></Card>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">{t("steps")}</CardTitle><p className="text-xs text-muted-foreground">{t("stepConfigHint")}</p></CardHeader><CardContent className="space-y-3"><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => setSteps(reorder(steps, event, (step) => step))}><SortableContext items={steps} strategy={verticalListSortingStrategy}><div className="space-y-2">{steps.map((step) => <WorkflowStepRow key={step} step={step} config={stepConfigs[step]!} variableOptions={variableOptions} editable={editable} onChange={(config) => setStepConfigs({ ...stepConfigs, [step]: config })} onRemove={() => setSteps(steps.filter((item) => item !== step))} />)}</div></SortableContext></DndContext>{editable && WORKFLOW_STEPS.some((step) => !steps.includes(step)) && <Select onValueChange={(value) => addStep(value as ProvisioningStepType)}><SelectTrigger><Plus className="size-4" /><SelectValue placeholder={t("add")} /></SelectTrigger><SelectContent>{WORKFLOW_STEPS.filter((step) => !steps.includes(step)).map((step) => <SelectItem key={step} value={step}>{t(`step.${step}` as never)}</SelectItem>)}</SelectContent></Select>}</CardContent></Card>
      <EditorCard title={t("detailModules")} available={DETAIL_MODULES.filter((item) => !modules.includes(item))} editable={editable} onAdd={(value) => setModules([...modules, value as DetailModule])}><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => setModules(reorder(modules, event, (module) => module))}><SortableContext items={modules} strategy={verticalListSortingStrategy}><div className="space-y-2">{modules.map((module) => <SortableRow key={module} id={module} label={t(`module.${module}` as never)} editable={editable} onRemove={() => setModules(modules.filter((item) => item !== module))} />)}</div></SortableContext></DndContext></EditorCard>
    </div>
  </div>;
}

function ApprovalFieldRow({ field, editable, onChange, onRemove }: { field: ApprovalField; editable: boolean; onChange: (field: ApprovalField) => void; onRemove: () => void }) {
  const t = useTranslations("admin.workflow");
  const [open, setOpen] = useState(false);
  /* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and live transform values for rendering. */
  const sortable = useSortable({ id: field.key, disabled: !editable });
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="rounded-md border bg-background"><div className="flex min-h-11 items-center gap-2 px-3"><button type="button" disabled={!editable} className="cursor-grab text-muted-foreground disabled:cursor-default" {...sortable.attributes} {...sortable.listeners}><GripVertical className="size-4" /></button><span className="flex-1 text-sm font-medium">{field.label.zh}</span><code className="text-[10px] text-muted-foreground">{field.key}</code><Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setOpen(!open)}>{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>{editable && <Button type="button" size="icon" variant="ghost" className="size-8 text-red-600" onClick={onRemove}><Trash2 className="size-4" /></Button>}</div>{open && <div className="grid gap-3 border-t p-3 sm:grid-cols-2"><Labeled label={t("variableKey")}><Input disabled={!editable} value={field.key} onChange={(event) => onChange({ ...field, key: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} /></Labeled><Labeled label={t("fieldType")}><Select disabled={!editable} value={field.type} onValueChange={(type: ApprovalFieldType) => onChange({ ...field, type, sensitive: type === "password" ? field.sensitive : false })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{APPROVAL_FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{t(`approvalType.${type}` as never)}</SelectItem>)}</SelectContent></Select></Labeled><Labeled label={t("labelZh")}><Input disabled={!editable} value={field.label.zh} onChange={(event) => onChange({ ...field, label: { ...field.label, zh: event.target.value } })} /></Labeled><Labeled label={t("labelEn")}><Input disabled={!editable} value={field.label.en ?? ""} onChange={(event) => onChange({ ...field, label: { ...field.label, en: event.target.value } })} /></Labeled><Labeled label={t("description")}><Input disabled={!editable} value={field.description?.zh ?? ""} onChange={(event) => onChange({ ...field, description: event.target.value ? { ...field.description, zh: event.target.value } : undefined })} /></Labeled><Labeled label={t("defaultValue")}><Input disabled={!editable || field.type === "password"} value={field.defaultValue === undefined ? "" : String(field.defaultValue)} onChange={(event) => onChange({ ...field, defaultValue: field.type === "number" ? Number(event.target.value) : field.type === "boolean" ? event.target.value === "true" : event.target.value })} /></Labeled>{field.type === "select" && <div className="sm:col-span-2"><Labeled label={t("selectOptions")}><Textarea disabled={!editable} value={(field.options ?? []).map((option) => `${option.value}|${option.label.zh}`).join("\n")} onChange={(event) => onChange({ ...field, options: event.target.value.split("\n").filter(Boolean).map((line) => { const [value, label] = line.split("|"); return { value: value.trim(), label: { zh: (label ?? value).trim() } }; }) })} /></Labeled></div>}<ToggleLine label={t("required")} checked={field.required} disabled={!editable} onChange={(required) => onChange({ ...field, required })} /><ToggleLine label={t("exposeToOwner")} checked={field.exposeToOwner} disabled={!editable} onChange={(exposeToOwner) => onChange({ ...field, exposeToOwner })} />{field.type === "password" && <ToggleLine label={t("sensitiveEncrypted")} checked={field.sensitive} disabled={!editable} onChange={(sensitive) => onChange({ ...field, sensitive })} />}</div>}</div>;
  /* eslint-enable react-hooks/refs */
}

function WorkflowStepRow({ step, config, variableOptions, editable, onChange, onRemove }: { step: ProvisioningStepType; config: StepConfig; variableOptions: string[]; editable: boolean; onChange: (config: StepConfig) => void; onRemove: () => void }) {
  const t = useTranslations("admin.workflow");
  const [open, setOpen] = useState(false);
  /* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and live transform values for rendering. */
  const sortable = useSortable({ id: step, disabled: !editable });
  const addRequest = () => {
    const request: HttpRequestConfig = { id: `request_${crypto.randomUUID().slice(0, 8)}`, name: { zh: "HTTP 请求", en: "HTTP request" }, timing: "AFTER", method: "POST", urlTemplate: "https://", headers: [], bodyTemplate: "{}", expectedStatuses: "200-299" };
    onChange({ ...config, requests: [...config.requests, request] });
  };
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="rounded-md border bg-background">
    <div className="flex min-h-11 items-center gap-2 px-3"><button type="button" disabled={!editable} className="cursor-grab text-muted-foreground" {...sortable.attributes} {...sortable.listeners}><GripVertical className="size-4" /></button><span className="flex-1 text-sm">{config.name?.zh || t(`step.${step}` as never)}</span>{config.requests.length > 0 && <span className="text-[10px] text-blue-600">{config.requests.length} HTTP</span>}<Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setOpen(!open)}>{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>{editable && <Button size="icon" variant="ghost" className="size-8 text-red-600" onClick={onRemove}><Trash2 className="size-4" /></Button>}</div>
    {open && <div className="space-y-4 border-t p-3">
      <div className="grid gap-3 sm:grid-cols-2"><Labeled label={t("stepName")}><Input disabled={!editable} value={config.name?.zh ?? t(`step.${step}` as never)} onChange={(event) => onChange({ ...config, name: { ...config.name, zh: event.target.value } })} /></Labeled><ToggleLine label={t("runBuiltIn")} checked={config.runBuiltIn} disabled={!editable} onChange={(runBuiltIn) => onChange({ ...config, runBuiltIn })} /></div>
      <Labeled label={t("stepDescription")}><Textarea disabled={!editable} rows={2} value={config.description?.zh ?? ""} onChange={(event) => onChange({ ...config, description: event.target.value ? { ...config.description, zh: event.target.value } : undefined })} /></Labeled>
      <div className="grid grid-cols-2 gap-3"><Labeled label={t("timeoutSeconds")}><Input disabled={!editable} type="number" min={5} max={3600} value={config.timeoutSeconds} onChange={(event) => onChange({ ...config, timeoutSeconds: Number(event.target.value) })} /></Labeled><Labeled label={t("failurePolicy")}><Select disabled={!editable} value={config.failurePolicy} onValueChange={(failurePolicy: "STOP" | "SKIP") => onChange({ ...config, failurePolicy })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="STOP">{t("failureStop")}</SelectItem><SelectItem value="SKIP">{t("failureSkip")}</SelectItem></SelectContent></Select></Labeled></div>
      {config.runBuiltIn && <div className="space-y-2"><Label>{t("inputMappings")}</Label>{STEP_INPUT_SPECS[step].map((input) => <div key={input.key} className="grid grid-cols-[120px_1fr] items-center gap-2"><code className="text-xs">{input.key}</code><Select disabled={!editable} value={config.inputBindings[input.key] ?? input.defaultBinding} onValueChange={(value) => onChange({ ...config, inputBindings: { ...config.inputBindings, [input.key]: value } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{variableOptions.map((variable) => <SelectItem key={variable} value={variable}>{variable}</SelectItem>)}</SelectContent></Select></div>)}</div>}
      <div className="space-y-2 border-t pt-3"><div className="flex items-center justify-between"><div><Label>{t("httpRequests")}</Label><p className="text-[10px] text-muted-foreground">{t("httpRequestsHint")}</p></div>{editable && <Button type="button" size="sm" variant="outline" onClick={addRequest}><Plus className="size-4" />{t("addRequest")}</Button>}</div>{config.requests.map((request, index) => <HttpRequestEditor key={request.id} request={request} editable={editable} onChange={(next) => onChange({ ...config, requests: config.requests.map((item, itemIndex) => itemIndex === index ? next : item) })} onRemove={() => onChange({ ...config, requests: config.requests.filter((_, itemIndex) => itemIndex !== index) })} />)}</div>
    </div>}
  </div>;
  /* eslint-enable react-hooks/refs */
}

function HttpRequestEditor({ request, editable, onChange, onRemove }: { request: HttpRequestConfig; editable: boolean; onChange: (request: HttpRequestConfig) => void; onRemove: () => void }) {
  const t = useTranslations("admin.workflow");
  const headersText = request.headers.map((header) => `${header.name}: ${header.valueTemplate}`).join("\n");
  return <div className="space-y-3 rounded-md border border-blue-100 bg-blue-50/30 p-3"><div className="flex items-center gap-2"><Input disabled={!editable} value={request.name.zh} onChange={(event) => onChange({ ...request, name: { ...request.name, zh: event.target.value } })} /><Button type="button" size="icon" variant="ghost" className="shrink-0 text-red-600" disabled={!editable} onClick={onRemove}><Trash2 className="size-4" /></Button></div><div className="grid grid-cols-2 gap-2"><Labeled label={t("requestTiming")}><Select disabled={!editable} value={request.timing} onValueChange={(timing: "BEFORE" | "AFTER") => onChange({ ...request, timing })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="BEFORE">{t("beforeBuiltIn")}</SelectItem><SelectItem value="AFTER">{t("afterBuiltIn")}</SelectItem></SelectContent></Select></Labeled><Labeled label={t("requestMethod")}><Select disabled={!editable} value={request.method} onValueChange={(method: HttpRequestConfig["method"]) => onChange({ ...request, method })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <SelectItem key={method} value={method}>{method}</SelectItem>)}</SelectContent></Select></Labeled></div><Labeled label={t("urlTemplate")}><Input disabled={!editable} value={request.urlTemplate} onChange={(event) => onChange({ ...request, urlTemplate: event.target.value })} placeholder="https://api.example.com/resources/{{url:system.vmid}}" /></Labeled><Labeled label={t("headerTemplates")}><Textarea disabled={!editable} rows={3} value={headersText} onChange={(event) => onChange({ ...request, headers: event.target.value.split("\n").filter(Boolean).map((line) => { const index = line.indexOf(":"); return { name: line.slice(0, index).trim(), valueTemplate: line.slice(index + 1).trim() }; }) })} placeholder="Authorization: Bearer {{approval.apiToken}}" /></Labeled><Labeled label={t("bodyTemplate")}><Textarea disabled={!editable} rows={5} className="font-mono text-xs" value={request.bodyTemplate ?? ""} onChange={(event) => onChange({ ...request, bodyTemplate: event.target.value })} placeholder={'{"name": {{json:request.resource_name}}}'} /></Labeled><div className="grid grid-cols-2 gap-2"><Labeled label={t("expectedStatuses")}><Input disabled={!editable} value={request.expectedStatuses} onChange={(event) => onChange({ ...request, expectedStatuses: event.target.value })} /></Labeled><Labeled label={t("captureVariable")}><Input disabled={!editable} value={request.captureVariable ?? ""} onChange={(event) => onChange({ ...request, captureVariable: event.target.value.replace(/[^a-zA-Z0-9_]/g, "") || undefined })} placeholder="createdResource" /></Labeled></div><p className="text-[10px] text-muted-foreground">{t("templateSyntax")}</p></div>;
}

function EditorCard({ title, available, editable, onAdd, children }: { title: string; available: readonly string[]; editable: boolean; onAdd: (value: string) => void; children: React.ReactNode }) { const t = useTranslations("admin.workflow"); return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-3">{children}{editable && available.length > 0 && <Select onValueChange={onAdd}><SelectTrigger><Plus className="size-4" /><SelectValue placeholder={t("add")} /></SelectTrigger><SelectContent>{available.map((item) => <SelectItem key={item} value={item}>{t(`module.${item}` as never)}</SelectItem>)}</SelectContent></Select>}</CardContent></Card>; }
function SortableRow({ id, label, editable, onRemove }: { id: string; label: string; editable: boolean; onRemove: () => void }) { /* eslint-disable react-hooks/refs */ const sortable = useSortable({ id, disabled: !editable }); return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3"><button type="button" className="cursor-grab text-muted-foreground" disabled={!editable} {...sortable.attributes} {...sortable.listeners}><GripVertical className="size-4" /></button><span className="flex-1 text-sm">{label}</span>{editable && <Button size="icon" variant="ghost" className="size-8 text-red-600" onClick={onRemove}><Trash2 className="size-4" /></Button>}</div>; /* eslint-enable react-hooks/refs */ }
function Labeled({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>; }
function ToggleLine({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) { return <div className="flex items-center justify-between gap-3 text-sm"><span>{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onChange} /></div>; }
