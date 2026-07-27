/**
 * Custom server: Next.js + the noVNC websocket proxy.
 *
 * Browsers cannot attach the PVE API-token header to a WebSocket, so the
 * console connects to /vncws?token=… here; the token is an AES-256-GCM
 * blob (minted by /api/vms/[id]/vnc, 60 s TTL) containing the PVE
 * vncwebsocket URL + Authorization header. The browser never sees PVE
 * credentials. Run with: node server.js (dev), NODE_ENV=production node server.js
 */
const { createServer } = require("http");
const crypto = require("crypto");
const next = require("next");
const { WebSocketServer, WebSocket } = require("ws");
const cron = require("node-cron");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();
const cronToken = process.env.INTERNAL_CRON_TOKEN || crypto.randomBytes(32).toString("hex");
process.env.INTERNAL_CRON_TOKEN = cronToken;
const workerId = crypto.randomUUID();
const canonicalOrigin = (() => {
  try { return new URL(process.env.NEXTAUTH_URL || `http://localhost:${port}`).origin; }
  catch { return `http://localhost:${port}`; }
})();

function decryptToken(token) {
  const keyHex = process.env.APP_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("APP_ENCRYPTION_KEY not set");
  const [iv, tag, data] = token.split(".");
  if (!iv || !tag || !data) throw new Error("malformed token");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);
  return JSON.parse(plain.toString("utf8"));
}

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));
  const nextUpgrade = app.getUpgradeHandler();
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/vncws") {
      // Everything else (e.g. dev HMR) goes to Next.
      nextUpgrade(req, socket, head);
      return;
    }

    let target;
    try {
      target = decryptToken(url.searchParams.get("token") || "");
      if (typeof target.exp !== "number" || target.exp < Date.now()) throw new Error("expired");
      const parsed = new URL(target.url);
      if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") throw new Error("bad target");
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(target.url, ["binary"], {
        headers: { Authorization: target.auth },
        rejectUnauthorized: target.tlsVerify !== false,
        handshakeTimeout: 10_000,
      });
      const closeBoth = () => {
        try { client.close(); } catch {}
        try { upstream.close(); } catch {}
      };
      upstream.on("open", () => {
        client.on("message", (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        });
        upstream.on("message", (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });
      });
      upstream.on("close", closeBoth);
      upstream.on("error", closeBoth);
      client.on("close", closeBoth);
      client.on("error", closeBoth);
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (${dev ? "dev" : "prod"})`);
    if (!dev && process.env.AI_CRON_ENABLED !== "false") {
      let cronBusy = false;
      cron.schedule("* * * * *", async () => {
        if (cronBusy) return;
        cronBusy = true;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/internal/ai/cron`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cronToken}`,
              Origin: canonicalOrigin,
              "X-Cumulet-Worker": workerId,
            },
            signal: AbortSignal.timeout(15 * 60_000),
          });
          if (!response.ok) console.error(`[ai-cron] request failed with HTTP ${response.status}`);
        } catch (error) {
          console.error("[ai-cron] request failed:", error instanceof Error ? error.message : "error");
        } finally {
          cronBusy = false;
        }
      });
    }
    if (!dev && process.env.LIFECYCLE_CRON_ENABLED !== "false") {
      let lifecycleBusy = false;
      cron.schedule("*/5 * * * *", async () => {
        if (lifecycleBusy) return;
        lifecycleBusy = true;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/internal/lifecycle/cron`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cronToken}`,
              Origin: canonicalOrigin,
              "X-Cumulet-Worker": workerId,
            },
            signal: AbortSignal.timeout(4 * 60_000),
          });
          if (!response.ok) console.error(`[lifecycle-cron] request failed with HTTP ${response.status}`);
        } catch (error) {
          console.error("[lifecycle-cron] request failed:", error instanceof Error ? error.message : "error");
        } finally {
          lifecycleBusy = false;
        }
      });
    }
  });
});
