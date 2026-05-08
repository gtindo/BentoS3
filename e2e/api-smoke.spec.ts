import { expect, test } from "@playwright/test";
import { BentoS3 } from "../src/index.js";

test("returns an S3 list buckets XML response", async ({ request }) => {
  const server = new BentoS3({ auth: { enabled: false }, port: 0 });
  await server.start();

  try {
    const endpoint = server.endpoint;

    if (!endpoint) {
      throw new Error("Server must expose an endpoint after startup.");
    }

    const response = await request.get(endpoint);
    const body = await response.text();

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/xml");
    expect(body).toContain("ListAllMyBucketsResult");
  } finally {
    await server.stop();
  }
});
