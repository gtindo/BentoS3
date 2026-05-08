import { Readable } from "node:stream";
import type { BentoHandler, BentoRequest, BentoResponse } from "../core/types.js";
import { resolveAdapterPath, type AdapterPathOptions } from "./path.js";

const DEFAULT_METHOD = "GET";
const HEADER_HOST = "host";
const STATUS_NO_CONTENT = 204;
const STATUS_NOT_MODIFIED = 304;

export type FetchBentoS3Options = AdapterPathOptions;

export async function handleFetchRequest(
  handler: BentoHandler,
  request: Request,
  options: FetchBentoS3Options = {},
): Promise<Response> {
  const bentoRequest = createBentoRequestFromFetchRequest(request, options);
  const bentoResponse = await handler.handle(bentoRequest);

  return createFetchResponse(bentoResponse);
}

export function createBentoRequestFromFetchRequest(
  request: Request,
  options: FetchBentoS3Options = {},
): BentoRequest {
  const url = new URL(request.url);
  const path = resolveAdapterPath(`${url.pathname}${url.search}`, options);
  const headers = createHeaderRecord(request.headers);
  const body = request.body ? Readable.fromWeb(request.body) : undefined;

  headers[HEADER_HOST] ??= url.host;

  return {
    method: request.method || DEFAULT_METHOD,
    url: path.url,
    path: path.path,
    query: url.searchParams,
    headers,
    ...(path.canonicalPath ? { canonicalPath: path.canonicalPath } : {}),
    ...(body ? { body } : {}),
  };
}

export function createFetchResponse(response: BentoResponse): Response {
  const headers = new Headers();

  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const headerValue of value) {
        headers.append(name, headerValue);
      }
      continue;
    }

    headers.set(name, String(value));
  }

  return new Response(createFetchResponseBody(response), {
    status: response.statusCode,
    headers,
  });
}

function createHeaderRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [name, value] of headers.entries()) {
    result[name] = value;
  }

  return result;
}

function createFetchResponseBody(response: BentoResponse): ConstructorParameters<typeof Response>[0] {
  if (isBodyForbiddenStatusCode(response.statusCode)) {
    return null;
  }

  const { body } = response;

  if (body === undefined) {
    return null;
  }

  if (typeof body === "string" || body instanceof Uint8Array) {
    return body;
  }

  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream;
  }

  return Readable.toWeb(Readable.from(body)) as ReadableStream;
}

function isBodyForbiddenStatusCode(statusCode: number): boolean {
  return statusCode === STATUS_NO_CONTENT || statusCode === STATUS_NOT_MODIFIED;
}
