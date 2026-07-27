import { ApiError } from "./api";

/** Read a request body with an actual byte cap, including chunked uploads. */
export async function readLimitedText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "payload_too_large");
  }
  if (!req.body) return "";

  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "payload_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_body_encoding");
  } finally {
    reader.releaseLock();
  }
}
