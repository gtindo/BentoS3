import type { BentoRequest } from "./types.js";

export const DEFAULT_MAX_REQUEST_BODY_BYTES = 100 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  public readonly limitBytes: number;

  public constructor(limitBytes: number) {
    super(`Request body exceeds the configured ${String(limitBytes)} byte limit.`);
    this.name = "RequestBodyTooLargeError";
    this.limitBytes = limitBytes;
  }
}

export async function readRequestBody(
  body: BentoRequest["body"],
  maxBodyBytes: number,
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for await (const chunk of body) {
    const bytes =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
    receivedBytes += bytes.byteLength;

    if (receivedBytes > maxBodyBytes) {
      throw new RequestBodyTooLargeError(maxBodyBytes);
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks, receivedBytes);
}
