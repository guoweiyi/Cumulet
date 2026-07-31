"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Clipboard,
  ClipboardPaste,
  Copy,
  Keyboard,
  Loader2,
  Maximize,
  RotateCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type RFBInstance = import("@novnc/novnc").default;

/** Full-page noVNC console (opened in its own window from the VM panel). */
export function VncConsole({ bindingId, vmid }: { bindingId: string; vmid: number }) {
  const t = useTranslations("vm");
  const tc = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBInstance | null>(null);
  const [state, setState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [clipboardText, setClipboardText] = useState("");

  const connect = useCallback(async () => {
    setState("connecting");
    rfbRef.current?.disconnect();
    rfbRef.current = null;

    try {
      const res = await fetch(`/api/vms/${bindingId}/vnc`, { method: "POST" });
      if (!res.ok) throw new Error(`vnc ticket: ${res.status}`);
      const { wsToken, password } = await res.json();

      const { default: RFB } = await import("@novnc/novnc");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${location.host}/vncws?token=${encodeURIComponent(wsToken)}`;
      const rfb = new RFB(containerRef.current!, url, { credentials: { password } });
      rfb.scaleViewport = true;
      rfb.background = "#111";
      rfb.addEventListener("connect", () => setState("connected"));
      rfb.addEventListener("disconnect", () => setState("disconnected"));
      rfb.addEventListener("credentialsrequired", () => rfb.sendCredentials({ password }));
      rfb.addEventListener("clipboard", (event: Event) => {
        const text = (event as CustomEvent<{ text?: string }>).detail?.text;
        if (text) setClipboardText(text);
      });
      rfbRef.current = rfb;
    } catch {
      setState("disconnected");
    }
  }, [bindingId]);

  useEffect(() => {
    void connect();
    return () => rfbRef.current?.disconnect();
  }, [connect]);

  function sendClipboard() {
    const rfb = rfbRef.current;
    if (!rfb || state !== "connected") return;
    rfb.clipboardPasteFrom(clipboardText);
  }

  async function copyClipboard() {
    if (!clipboardText) return;
    try {
      await navigator.clipboard.writeText(clipboardText);
      toast.success(tc("copied"));
    } catch {
      // Clipboard access denied or unavailable; ignore.
    }
  }

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col bg-neutral-950 text-white">
      <div className="flex h-11 items-center gap-2 border-b border-neutral-800 px-3">
        <span className="text-sm font-medium">
          {t("consoleTitle")} — VM {vmid}
        </span>
        <span className="text-xs text-neutral-400">
          {state === "connecting" && t("consoleConnecting")}
          {state === "disconnected" && t("consoleDisconnected")}
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="text-neutral-300 hover:bg-neutral-800 hover:text-white"
          onClick={() => setClipboardOpen((open) => !open)}
        >
          <Clipboard className="size-4" /> {t("clipboard")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-neutral-300 hover:bg-neutral-800 hover:text-white"
          onClick={() => rfbRef.current?.sendCtrlAltDel()}
        >
          <Keyboard className="size-4" /> Ctrl+Alt+Del
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-neutral-300 hover:bg-neutral-800 hover:text-white"
          onClick={connect}
        >
          <RotateCw className="size-4" /> {t("reconnect")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-neutral-300 hover:bg-neutral-800 hover:text-white"
          onClick={() => containerRef.current?.requestFullscreen()}
        >
          <Maximize className="size-4" /> {t("fullscreen")}
        </Button>
      </div>
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {clipboardOpen && (
          <div className="absolute right-3 top-3 z-10 w-80 rounded-lg border border-neutral-700 bg-neutral-900/95 p-3 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("clipboard")}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                onClick={() => setClipboardOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <Textarea
              rows={6}
              className="mt-2 resize-none font-mono text-xs text-neutral-100 placeholder:text-neutral-500"
              value={clipboardText}
              onChange={(event) => setClipboardText(event.target.value)}
              placeholder={t("clipboardPlaceholder")}
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-500">
              {t("clipboardHint")}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={state !== "connected" || !clipboardText}
                onClick={sendClipboard}
              >
                <ClipboardPaste className="size-3.5" /> {t("clipboardSend")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!clipboardText}
                onClick={copyClipboard}
              >
                <Copy className="size-3.5" /> {t("clipboardCopy")}
              </Button>
            </div>
          </div>
        )}
        {state !== "connected" && (
          <div className="absolute inset-0 flex items-center justify-center">
            {state === "connecting" ? (
              <Loader2 className="size-8 animate-spin text-neutral-500" />
            ) : (
              <Button variant="secondary" onClick={connect}>
                <RotateCw className="size-4" /> {t("reconnect")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
