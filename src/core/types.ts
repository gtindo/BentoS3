export interface BentoRequest {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  body?: AsyncIterable<Uint8Array> | NodeJS.ReadableStream;
  remoteAddress?: string;
}

export interface BentoResponse {
  statusCode: number;
  headers: Record<string, string | number | string[]>;
  body?: string | Uint8Array | AsyncIterable<Uint8Array> | NodeJS.ReadableStream;
}

export interface BentoHandler {
  handle(request: BentoRequest): Promise<BentoResponse>;
}
