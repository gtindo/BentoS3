# BentoS3 Architecture

BentoS3 is designed around a framework-neutral S3 protocol engine. The core implementation does not depend on Express, Koa, Fastify, or any specific Node.js web framework.

## System Overview

```text
                 ┌────────────────────────────┐
                 │ AWS SDK / CLI / Test Suite │
                 └─────────────┬──────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│                  Framework Adapter Layer                 │
│                                                          │
│  Node HTTP       Express       Koa       Fastify         │
│  Fetch           Custom        Future adapters           │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│              BentoS3 Internal HTTP Contract              │
│                                                          │
│  BentoRequest  ─────────────▶  BentoS3Core.handle()      │
│  BentoResponse ◀─────────────  framework-neutral result  │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│                    BentoS3 Core Engine                   │
│                                                          │
│  S3 Router                                               │
│  SigV4 Auth                                              │
│  S3 Operation Dispatcher                                 │
│  XML Response Serializer                                 │
│  Admin Router                                            │
│  Dashboard Router                                        │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│                    Storage And Auth                      │
│                                                          │
│  FileSystemStorageDriver                                 │
│  MemoryStorageDriver                                     │
│  JsonAuthStore                                           │
│  MemoryAuthStore                                         │
│  JsonDashboardStore                                      │
└──────────────────────────────────────────────────────────┘
```

## Core Principle

BentoS3 is a protocol engine first and a server second.

All S3 behavior lives behind this interface:

```ts
export interface BentoHandler {
  handle(request: BentoRequest): Promise<BentoResponse>;
}
```

This allows BentoS3 to run in multiple contexts:

- A standalone CLI server using Node `http`.
- A Vitest/Jest-managed test server using dynamic ports.
- An Express app.
- A Koa app.
- A Fastify app.
- A custom Node framework.
- Direct handler-level tests with no network port.

## Internal Request And Response

```ts
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
```

Adapters are responsible for translating framework-native request/response objects into this internal contract.

## Adapter Responsibilities

Adapters should only do transport translation.

They must:

- Preserve the HTTP method.
- Preserve the raw path and query string.
- Preserve headers and header values.
- Stream the request body without pre-consuming it.
- Write status, headers, and body from `BentoResponse` back to the native response.
- Avoid S3-specific logic.

They must not:

- Parse S3 operations.
- Validate SigV4.
- Read or write object storage directly.
- Apply framework body parsers before BentoS3 receives the request stream.

## Managed Server

The managed `BentoS3` class owns a Node HTTP server.

```ts
const s3 = new BentoS3({ port: 0 });

await s3.start();

console.log(s3.endpoint);

await s3.stop();
```

When `port: 0` is provided, Node assigns an available port. BentoS3 reads the bound address after startup and exposes it through `endpoint` and `port`.

## Core Request Flow

```text
Incoming HTTP request
  │
  ▼
Framework adapter
  │
  ▼
BentoRequest
  │
  ▼
BentoS3Core.handle()
  │
  ├── Route classification
  │   ├── S3 API
  │   ├── Admin API
  │   └── Dashboard UI
  │
  ├── S3 SigV4 authentication
  │
  ├── S3 operation dispatch
  │
  ├── Storage/Auth driver calls
  │
  └── XML, JSON, file, or HTML response serialization
  │
  ▼
BentoResponse
  │
  ▼
Framework adapter writes native response
```

## S3 Middleware Flow

```text
BentoRequest
  │
  ▼
S3 request parser
  │
  ├── bucket
  ├── object key
  ├── query operation
  ├── headers
  └── payload stream
  │
  ▼
SigV4 validator
  │
  ├── credential lookup
  ├── canonical request
  ├── string to sign
  ├── signing key derivation
  └── signature comparison
  │
  ▼
Operation dispatcher
  │
  ├── bucket operations
  ├── object operations
  └── listing operations
  │
  ▼
Storage driver
  │
  ▼
S3 response serializer
```

## Storage Engine

The primary storage engine uses the local filesystem.

```text
.bentos3/
  buckets/
    photos/
      .bentos3-bucket.json
      cats/leo.jpg
      cats/leo.jpg.meta.json
  auth/
    credentials.json
    dashboard-users.json
    sessions.json
  tmp/
```

Bucket mapping:

```text
bucket: photos
path:   .bentos3/buckets/photos/
```

Object mapping:

```text
key:    cats/leo.jpg
path:   .bentos3/buckets/photos/cats/leo.jpg
meta:   .bentos3/buckets/photos/cats/leo.jpg.meta.json
```

The filesystem driver must protect against path traversal and must not follow paths outside the configured root directory.

## Metadata

Each object can have a JSON metadata sidecar.

```json
{
  "key": "cats/leo.jpg",
  "size": 1234,
  "etag": "\"d41d8cd98f00b204e9800998ecf8427e\"",
  "contentType": "image/jpeg",
  "lastModified": "2026-05-08T00:00:00.000Z",
  "userMetadata": {
    "source": "integration-test"
  }
}
```

## Auth

BentoS3 supports two auth modes:

- In-memory auth for tests.
- JSON-backed auth for persistent local development.

S3 credentials are used by SigV4 validation.

Dashboard users are separate from S3 access keys. Dashboard passwords are hashed with Node `crypto.scrypt`.

## Dashboard

The dashboard is server-side rendered and framework-neutral.

Technology choices:

- EJS for rendering.
- Tailwind CSS compiled at build time.
- Turbo for navigation and form submissions.
- JSON files for users and sessions.
- Node `crypto` for password hashing and session token generation.

Dashboard routes return regular `BentoResponse` objects with HTML bodies.

## Dashboard Flow

```text
Browser
  │
  ▼
GET /ui/buckets
  │
  ▼
Dashboard router
  │
  ├── session guard
  ├── storage query
  ├── EJS render
  └── HTML BentoResponse
```

## Initial S3 API Surface

Bucket operations:

| S3 Action | HTTP | Path |
|---|---:|---|
| ListBuckets | `GET` | `/` |
| CreateBucket | `PUT` | `/:bucket` |
| DeleteBucket | `DELETE` | `/:bucket` |
| HeadBucket | `HEAD` | `/:bucket` |
| ListObjectsV2 | `GET` | `/:bucket?list-type=2` |

Object operations:

| S3 Action | HTTP | Path |
|---|---:|---|
| PutObject | `PUT` | `/:bucket/:key` |
| GetObject | `GET` | `/:bucket/:key` |
| HeadObject | `HEAD` | `/:bucket/:key` |
| DeleteObject | `DELETE` | `/:bucket/:key` |
| DeleteObjects | `POST` | `/:bucket?delete` |
| CopyObject | `PUT` | `/:bucket/:key` with `x-amz-copy-source` |

## Testing Architecture

Integration testing is required, not optional.

The test suite should validate:

- Official AWS SDK compatibility.
- Effective filesystem writes and deletes.
- Metadata sidecar correctness.
- Persistence across server restarts.
- SigV4 validation.
- Adapter behavior across Node HTTP, Express, Koa, Fastify, and Fetch.

Shared adapter tests should use a common compatibility suite so every adapter is held to the same behavior.

## Package Exports

Planned exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core/index.js",
    "./adapters/node-http": "./dist/adapters/node-http.js",
    "./adapters/express": "./dist/adapters/express.js",
    "./adapters/koa": "./dist/adapters/koa.js",
    "./adapters/fastify": "./dist/adapters/fastify.js",
    "./adapters/fetch": "./dist/adapters/fetch.js"
  }
}
```

## Security Boundaries

BentoS3 is intended for local development and tests.

Baseline protections still matter:

- SigV4 should be enabled by default for S3 API routes.
- Dashboard should be bound to localhost by default.
- Passwords must be hashed, never stored in plaintext.
- Session token hashes should be stored instead of raw tokens.
- Path traversal must be blocked.
- Secrets must not be logged.
- Request body size limits should be configurable.
