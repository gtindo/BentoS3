import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BentoHandler, BentoRequest, BentoResponse } from "../core/types.js";

const DEFAULT_HOST = "127.0.0.1";
const HEADER_HOST = "host";
const HTTP_PROTOCOL = "http";
const METHOD_GET = "GET";
const REQUEST_URL_FALLBACK = "/";

export async function handleNodeHttpRequest(
  handler: BentoHandler,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const bentoRequest = createBentoRequestFromNodeRequest(request);
  const bentoResponse = await handler.handle(bentoRequest);

  await writeNodeHttpResponse(response, bentoResponse);
}

export function createBentoRequestFromNodeRequest(request: IncomingMessage): BentoRequest {
  const host = request.headers[HEADER_HOST] ?? DEFAULT_HOST;
  const rawUrl = request.url ?? REQUEST_URL_FALLBACK;
  const url = new URL(rawUrl, `${HTTP_PROTOCOL}://${host}`);
  const remoteAddress = request.socket.remoteAddress;

  return {
    method: request.method ?? METHOD_GET,
    url: rawUrl,
    path: url.pathname,
    query: url.searchParams,
    headers: request.headers,
    body: request,
    ...(remoteAddress ? { remoteAddress } : {}),
  };
}

export async function writeNodeHttpResponse(
  response: ServerResponse,
  bentoResponse: BentoResponse,
): Promise<void> {
  response.statusCode = bentoResponse.statusCode;

  for (const [name, value] of Object.entries(bentoResponse.headers)) {
    response.setHeader(name, value);
  }

  if (bentoResponse.body === undefined) {
    response.end();
    return;
  }

  if (typeof bentoResponse.body === "string" || bentoResponse.body instanceof Uint8Array) {
    response.end(bentoResponse.body);
    return;
  }

  if (isNodeReadableStream(bentoResponse.body)) {
    await pipeline(bentoResponse.body, response);
    return;
  }

  for await (const chunk of bentoResponse.body) {
    response.write(chunk);
  }

  response.end();
}

export function isNodeReadableStream(value: unknown): value is NodeJS.ReadableStream {
  return value instanceof Readable;
}
