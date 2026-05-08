import { describe, expect, it } from "vitest";
import { BentoS3Core, type BentoRequest } from "../../index.js";

const EMPTY_HEADERS = {};

describe("BentoS3Core", () => {
  it("lists buckets without a network port", async () => {
    const core = new BentoS3Core();
    const response = await core.handle(createRequest("GET", "/"));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("ListAllMyBucketsResult");
  });

  it("creates and heads an in-memory bucket", async () => {
    const core = new BentoS3Core();

    const createResponse = await core.handle(createRequest("PUT", "/photos"));
    const headResponse = await core.handle(createRequest("HEAD", "/photos"));

    expect(createResponse.statusCode).toBe(200);
    expect(headResponse.statusCode).toBe(200);
  });

  it("returns S3 XML errors for unsupported operations", async () => {
    const core = new BentoS3Core();
    const response = await core.handle(createRequest("DELETE", "/photos/cat.jpg"));

    expect(response.statusCode).toBe(405);
    expect(response.body).toContain("MethodNotAllowed");
  });
});

function createRequest(method: string, path: string): BentoRequest {
  return {
    method,
    url: path,
    path,
    query: new URLSearchParams(),
    headers: EMPTY_HEADERS,
  };
}
