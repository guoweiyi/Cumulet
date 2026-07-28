"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Rocket, Save, Trash2 } from "lucide-react";
import type { ProvisioningStepType } from "@prisma/client";
import {
  DETAIL_MODULES,
  WORKFLOW_STEPS,
  type DetailModule,
  type WorkflowDefinition,
} from "@/lib/workflow-definition";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function WorkflowBuilder({
  schemaId,
  initialDefinition,
  editable,
  version,
  status,
}: {
  schemaId: string;
  initialDefinition: WorkflowDefinition;
  editable: boolean;
  version: number;
  status: string;
}) {
  const t = useTranslations("admin.workflow");
  const tc = useTranslations("common");
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [name, setName] = useState(initialDefinition.meta.name);
  const [resourceType, setResourceType] = useState(initialDefinition.meta.resourceType);
  const [steps, setSteps] = useState(initialDefinition.steps);
  const [modules, setModules] = useState(initialDefinition.detailModules);
  const [busy, setBusy] = useState(false);

  const definition = useMemo<WorkflowDefinition>(() => ({
    formatVersion: 1,
    meta: { name, resourceType },
    steps,
    detailModules: modules,
  }), [name, resourceType, steps, modules]);

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/workflows/${schemaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      if (!response.ok) {
        toast.error(tc("saveFailed"));
        return false;
      }
      toast.success(tc("saveSuccess"));
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!(await save())) return;
    const response = await fetch(`/api/admin/workflows/${schemaId}/publish`, { method: "POST" });
    if (!response.ok) return toast.error(tc("requestFailed"));
    router.push("/admin/workflows");
    router.refresh();
  }

  function reorder<T extends string>(items: T[], event: DragEndEvent): T[] {
    if (!event.over || event.active.id === event.over.id) return items;
    return arrayMove(items, items.indexOf(event.active.id as T), items.indexOf(event.over.id as T));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>{t("name")}</Label><Input disabled={!editable} value={name.zh} onChange={(event) => setName({ ...name, zh: event.target.value })} /></div>
          <div className="space-y-1.5"><Label>{t("resourceType")}</Label><Input disabled={!editable} value={resourceType} onChange={(event) => setResourceType(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} /></div>
        </div>
        <span className="pb-2 text-xs text-muted-foreground">v{version} · {status}</span>
        {editable && <><Button variant="outline" disabled={busy} onClick={save}><Save className="size-4" />{tc("save")}</Button><Button disabled={busy} onClick={publish}><Rocket className="size-4" />{t("publish")}</Button></>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EditorCard title={t("steps")} available={WORKFLOW_STEPS.filter((item) => !steps.includes(item))} editable={editable} onAdd={(value) => setSteps([...steps, value as ProvisioningStepType])}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => setSteps(reorder(steps, event))}>
            <SortableContext items={steps} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">{steps.map((step) => <SortableRow key={step} id={step} label={t(`step.${step}` as never)} editable={editable} onRemove={() => setSteps(steps.filter((item) => item !== step))} />)}</div>
            </SortableContext>
          </DndContext>
        </EditorCard>

        <EditorCard title={t("detailModules")} available={DETAIL_MODULES.filter((item) => !modules.includes(item))} editable={editable} onAdd={(value) => setModules([...modules, value as DetailModule])}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => setModules(reorder(modules, event))}>
            <SortableContext items={modules} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">{modules.map((module) => <SortableRow key={module} id={module} label={t(`module.${module}` as never)} editable={editable} onRemove={() => setModules(modules.filter((item) => item !== module))} />)}</div>
            </SortableContext>
          </DndContext>
        </EditorCard>
      </div>
    </div>
  );
}

function EditorCard({ title, available, editable, onAdd, children }: { title: string; available: readonly string[]; editable: boolean; onAdd: (value: string) => void; children: React.ReactNode }) {
  const t = useTranslations("admin.workflow");
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-3">{children}{editable && available.length > 0 && <Select onValueChange={onAdd}><SelectTrigger><Plus className="size-4" /><SelectValue placeholder={t("add")} /></SelectTrigger><SelectContent>{available.map((item) => <SelectItem key={item} value={item}>{t(item.startsWith("VALIDATE_") || item === "CLOUD_INIT" || item === "PVE_SECURITY_GROUP" || item === "EXTERNAL_ACCESS" || item === "JS_ASSET" || item === "JS_PERMISSION" || item === "NOTIFY" ? `step.${item}` as never : `module.${item}` as never)}</SelectItem>)}</SelectContent></Select>}</CardContent></Card>;
}

function SortableRow({ id, label, editable, onRemove }: { id: string; label: string; editable: boolean; onRemove: () => void }) {
  /* eslint-disable react-hooks/refs -- dnd-kit exposes callback refs and live transform values for rendering. */
  const sortable = useSortable({ id, disabled: !editable });
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="flex min-h-11 items-center gap-2 rounded-md border bg-background px-3"><button type="button" className="cursor-grab text-muted-foreground disabled:cursor-default" disabled={!editable} {...sortable.attributes} {...sortable.listeners}><GripVertical className="size-4" /></button><span className="flex-1 text-sm">{label}</span>{editable && <Button size="icon" variant="ghost" className="size-8 text-red-600" onClick={onRemove}><Trash2 className="size-4" /></Button>}</div>;
  /* eslint-enable react-hooks/refs */
}
