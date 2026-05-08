import { describe, expect, it } from "vitest";
import { classifyBentoRoute, parseS3Route } from "../router.js";
import type { BentoRequest } from "../../index.js";

const EMPTY_HEADERS = {};

describe("router", () => {
  it("classifies admin routes", () => {
    expect(classifyBentoRoute(createRequest("/admin/health"))).toEqual({ kind: "admin" });
  });

  it("classifies dashboard routes", () => {
    expect(classifyBentoRoute(createRequest("/dashboard"))).toEqual({ kind: "dashboard" });
  });

  it("parses S3 bucket and key paths", () => {
    expect(parseS3Route("/photos/cats/leo.jpg")).toEqual({
      kind: "s3",
      bucket: "photos",
      key: "cats/leo.jpg",
    });
  });
});

function createRequest(path: string): BentoRequest {
  return {
    method: "GET",
    url: path,
    path,
    query: new URLSearchParams(),
    headers: EMPTY_HEADERS,
  };
}
