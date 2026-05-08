# BentoS3

BentoS3 is a lightweight, S3-compatible API server for local development, automated testing, and CI environments.

It is designed as both:

- A standalone CLI-bootable S3-compatible server.
- An embeddable Node.js library for Vitest, Jest, and framework-based test suites.

BentoS3 aims to provide the most commonly used S3 behavior without the operational weight of MinIO, LocalStack, or a full object-storage server.

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
- Replication, lifecycle policies, object lock, ACLs, or bucket policies in the MVP.
- Mandatory dependency on a specific HTTP framework.

## Planned Usage

### Managed Test Server

```ts
import { BentoS3 } from "bentos3";

const s3 = new BentoS3({
  port: 0,
  auth: {
    mode: "memory",
    credentials: [
      {
        accessKeyId: "test",
        secretAccessKey: "test-secret",
      },
    ],
  },
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

### Framework-Embedded Server

```ts
import express from "express";
import { BentoS3Core } from "bento-s3";
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
  basePath: "/s3",
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

## S3 Compatibility Target

The first compatibility target is the official AWS SDK for JavaScript v3 using path-style addressing:

```ts
new S3Client({
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
  region: "us-east-1",
  credentials,
});
```

Initial S3 operations:

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

BentoS3 uses the local filesystem as its primary persistence layer.

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
```

Buckets map to directories. Objects map to files. Object metadata is stored in JSON sidecar files.

## Dashboard

The dashboard is planned for phase 4 and will be server-side rendered.

Technology choices:

- EJS templates.
- Tailwind CSS compiled at build time.
- Turbo for navigation and form behavior.
- JSON files for dashboard user/session storage.
- Node `crypto.scrypt` for password hashing.

No React, Next.js, or client-side SPA framework is planned for the dashboard.

## Testing Philosophy

Integration tests are central to BentoS3.

The project must prove that:

- The official AWS SDK can perform S3 operations against BentoS3.
- Filesystem operations actually create, read, update, and delete files on disk.
- Metadata sidecars are written correctly.
- Restarting BentoS3 with the same root directory preserves data.
- Each framework adapter preserves raw path, query, headers, and request body streams correctly.

## Documentation

- `ARCHITECTURE.md` describes the technical architecture.
- `work-plans/phase-1-core.md` describes the framework-neutral core and test harness.
- `work-plans/phase-2-storage-auth.md` describes filesystem, auth, and SigV4 work.
- `work-plans/phase-3-adapters.md` describes framework adapter work.
- `work-plans/phase-4-dashboard-cli-packaging.md` describes dashboard, CLI, and packaging work.

## Status

BentoS3 is currently in blueprint/planning stage.
