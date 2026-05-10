import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { BentoS3Core, MemoryAuthStore, type BentoRequest } from "../../index.js";

const EMPTY_HEADERS = {};
const TEST_ACCESS_KEY_ID = "test";
const TEST_SECRET_ACCESS_KEY = "test-secret";

describe("BentoS3Core", () => {
  it("lists buckets without a network port", async () => {
    const core = new BentoS3Core({ auth: { enabled: false } });
    const response = await core.handle(createRequest("GET", "/"));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("ListAllMyBucketsResult");
  });

  it("creates and heads an in-memory bucket", async () => {
    const core = new BentoS3Core({ auth: { enabled: false } });

    const createResponse = await core.handle(createRequest("PUT", "/photos"));
    const headResponse = await core.handle(createRequest("HEAD", "/photos"));

    expect(createResponse.statusCode).toBe(200);
    expect(headResponse.statusCode).toBe(200);
  });

  it("returns S3 XML errors for unsupported operations", async () => {
    const core = new BentoS3Core({ auth: { enabled: false } });
    const response = await core.handle(createRequest("PATCH", "/photos/cat.jpg"));

    expect(response.statusCode).toBe(405);
    expect(response.body).toContain("MethodNotAllowed");
  });

  it("rejects request bodies over the configured local limit", async () => {
    const core = new BentoS3Core({ auth: { enabled: false }, maxRequestBodyBytes: 4 });

    await core.handle(createRequest("PUT", "/photos"));
    const response = await core.handle(
      createRequest("PUT", "/photos/large.txt", createBody("large")),
    );

    expect(response.statusCode).toBe(413);
    expect(response.body).toContain("EntityTooLarge");
  });

  it("rejects missing authorization when auth is enabled", async () => {
    const core = new BentoS3Core({ authStore: createAuthStore() });
    const response = await core.handle(createRequest("GET", "/"));

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain("AccessDenied");
  });
});

function createAuthStore(): MemoryAuthStore {
  return new MemoryAuthStore([
    {
      accessKeyId: TEST_ACCESS_KEY_ID,
      secretAccessKey: TEST_SECRET_ACCESS_KEY,
      enabled: true,
      createdAt: new Date(),
    },
  ]);
}

function createRequest(method: string, path: string, body?: BentoRequest["body"]): BentoRequest {
  return {
    method,
    url: path,
    path,
    query: new URLSearchParams(),
    headers: EMPTY_HEADERS,
    ...(body ? { body } : {}),
  };
}

function createBody(value: string): NodeJS.ReadableStream {
  return Readable.from([new TextEncoder().encode(value)]);
}
