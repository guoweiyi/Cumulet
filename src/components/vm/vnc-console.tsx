"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Keyboard, Loader2, Maximize, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type RFBInstance = import("@novnc/novnc").default;

/** Full-page noVNC console (opened in its own window from the VM panel). */
export function VncConsole({ bindingId, vmid }: { bindingId: string; vmid: number }) {
  const t = useTranslations("vm");
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFBInstance | null>(null);
  const [state, setState] = useState<"connecting" | "connected" | "disconnected">("connecting");

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
      rfbRef.current = rfb;
    } catch {
      setState("disconnected");
    }
  }, [bindingId]);

  useEffect(() => {
    void connect();
    return () => rfbRef.current?.disconnect();
  }, [connect]);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-white">
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
