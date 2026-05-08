# BentoS3

BentoS3 is a lightweight, S3-compatible API server for local development, automated testing, and CI environments.

It is designed as both:

- A standalone CLI-bootable S3-compatible server.
- An embeddable Node.js library for Vitest, Jest, and framework-based test suites.

BentoS3 aims to provide the most commonly used S3 behavior without the operational weight of MinIO, LocalStack, or a full object-storage server.

## Installation

Install BentoS3 from npm:

```bash
npm install bento-s3
```

Then import it in your project:

```ts
import { BentoS3, MemoryAuthStore } from "bento-s3";
```

## Goals

- Support a practical subset of the S3 REST API.
- Work with the official AWS SDK for JavaScript.
- Persist buckets and objects to the local filesystem.
- Provide a framework-neutral core that can be embedded in any Node.js HTTP stack.
- Provide adapters for common frameworks such as Express, Koa, Fastify, and Node HTTP.
- Include a lightweight server-rendered dashboard.
- Keep dependencies lean for fast installs in CI.

## Non-Goals

- Production-grade object storage.
- Full S3 feature parity.
- Distributed storage.
- Replication, lifecycle policies, object lock, ACLs, or bucket policies.
- Mandatory dependency on a specific HTTP framework.

## Usage

### Managed Test Server

```ts
import { BentoS3, MemoryAuthStore } from "bento-s3";

const authStore = new MemoryAuthStore();
await authStore.createCredential({
  accessKeyId: "test",
  secretAccessKey: "test-secret",
});

const s3 = new BentoS3({
  port: 0,
  authStore,
});

await s3.start();

console.log(s3.endpoint);

await s3.stop();
```

### AWS SDK Client

```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const client = new S3Client({
  region: "us-east-1",
  endpoint: s3.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: "test",
    secretAccessKey: "test-secret",
  },
});

await client.send(
  new PutObjectCommand({
    Bucket: "photos",
    Key: "cat.jpg",
    Body: Buffer.from("image-bytes"),
  }),
);
```

### CLI

Start a local S3-compatible server with the dashboard enabled:

```bash
bentos3 serve
bentos3 serve --host 127.0.0.1 --port 9000 --root-dir ./.bentos3
```

Create a dashboard user:

```bash
bentos3 user create admin
bentos3 user create admin --password mypassword
```

List dashboard users and buckets:

```bash
bentos3 user list
bentos3 bucket list
```

Default server behavior:

| Option       | Default      |
| ------------ | ------------ |
| `--host`     | `127.0.0.1`  |
| `--port`     | `9000`       |
| `--root-dir` | `./.bentos3` |
| Dashboard    | Enabled      |
| Auth store   | JSON-backed  |

On first start, `bentos3 serve` bootstraps a default access key and prints the credentials.

### Framework-Embedded Server

```ts
import express from "express";
import { BentoS3Core } from "bento-s3/core";
import { expressAdapter } from "bento-s3/adapters/express";

const app = express();
const bento = new BentoS3Core();

app.use("/s3", expressAdapter(bento));
```

The AWS SDK endpoint for this mounted route should include the mount path:

```ts
new S3Client({
  endpoint: "http://127.0.0.1:3000/s3",
  forcePathStyle: true,
  region: "us-east-1",
  credentials,
});
```

### Framework Adapters

Express:

```ts
import { expressAdapter } from "bento-s3/adapters/express";

app.use("/s3", expressAdapter(bento));
```

Koa:

```ts
import { koaAdapter } from "bento-s3/adapters/koa";

app.use(koaAdapter(bento, { basePath: "/s3" }));
```

Fastify:

```ts
import { fastifyBentoS3 } from "bento-s3/adapters/fastify";

await app.register(fastifyBentoS3, {
  prefix: "/s3",
  bento,
});
```

Fetch:

```ts
import { handleFetchRequest } from "bento-s3/adapters/fetch";

const response = await handleFetchRequest(bento, request, { basePath: "/s3" });
```

### Body Parser Ordering

BentoS3 adapters must receive the raw request stream. Mount BentoS3 before body parsers for the S3 route:

```ts
app.use("/s3", expressAdapter(bento));
app.use(express.json());
```

Avoid this ordering for S3 requests:

```ts
app.use(express.json());
app.use("/s3", expressAdapter(bento));
```

The same rule applies to Koa middleware that reads `ctx.req`. Fastify registration installs a raw content-type parser for the plugin scope so S3 object uploads are not pre-parsed before BentoS3 receives them.

## Core Design

BentoS3 is protocol-engine first. The S3 implementation is not coupled to Express, Koa, Fastify, or any other framework.

The core accepts an internal request object and returns an internal response object:

```ts
export interface BentoRequest {
  method: string;
  url: string;
  path: string;
  canonicalPath?: string;
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

Adapters translate framework-specific request and response types into this contract.

## S3 Compatibility

The compatibility target is the official AWS SDK for JavaScript v3 using path-style addressing:

```ts
new S3Client({
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
  region: "us-east-1",
  credentials,
});
```

Supported S3 operations:

- `ListBuckets`
- `CreateBucket`
- `DeleteBucket`
- `HeadBucket`
- `ListObjectsV2`
- `PutObject`
- `GetObject`
- `HeadObject`
- `DeleteObject`
- `DeleteObjects`
- `CopyObject`

## Storage

BentoS3 uses the local filesystem as its primary persistence layer. Storage drivers write a `.bentos3/` data directory inside the configured `rootDir`.

Example layout:

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

Buckets map to directories. Objects map to files. Object metadata is stored in JSON sidecar files.

## Auth

BentoS3 supports two credential store implementations:

- `MemoryAuthStore` - in-memory, ideal for tests.
- `JsonAuthStore` - JSON-backed, persists credentials to disk for local development.

SigV4 authentication is enabled by default. Configure the auth store through `BentoS3` or `BentoS3Core` options:

```ts
import { BentoS3, JsonAuthStore } from "bento-s3";

const rootDir = "./.bentos3";

const s3 = new BentoS3({
  port: 9000,
  rootDir,
  authStore: new JsonAuthStore({ rootDir }),
});
```

Auth can be disabled for testing:

```ts
import { BentoS3Core } from "bento-s3/core";

const bento = new BentoS3Core({
  auth: { enabled: false },
});
```

## Dashboard

The dashboard is a server-rendered UI for managing buckets, objects, and access keys. It is enabled by default when running `bentos3 serve` or creating a `BentoS3` instance without `dashboard.enabled: false`.

Access the dashboard at `http://127.0.0.1:9000/ui`.

### Dashboard Features

- Browse and manage buckets and objects.
- Upload and download objects from the browser.
- Create and revoke S3 access keys.
- Session-based authentication with `HttpOnly` cookies.

### Dashboard Users

Create a dashboard user via the CLI:

```bash
bentos3 user create admin --password mypassword
```

Dashboard passwords are hashed with Node `crypto.scrypt`. Sessions store token hashes, not raw tokens.

### Technology

- Inline HTML rendering.
- Inline CSS styled with a compact dashboard design system.
- Turbo-compatible static script placeholder.
- JSON files for user and session storage.

## Package Exports

| Export path                   | Contents                                                                |
| ----------------------------- | ----------------------------------------------------------------------- |
| `bento-s3`                    | `BentoS3`, `BentoS3Core`, adapters, auth stores, storage drivers, types |
| `bento-s3/core`               | `BentoS3Core`, `BentoS3CoreOptions`                                     |
| `bento-s3/adapters/node-http` | Node HTTP adapter utilities                                             |
| `bento-s3/adapters/express`   | `expressAdapter`                                                        |
| `bento-s3/adapters/koa`       | `koaAdapter`                                                            |
| `bento-s3/adapters/fastify`   | `fastifyBentoS3`                                                        |
| `bento-s3/adapters/fetch`     | `handleFetchRequest`                                                    |
