import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("built package exposes root, core, adapters, declarations, and CLI bin", async () => {
  const root = join(import.meta.dirname, "..");
  const packageRoot = await import("../dist/index.js");
  const core = await import("../dist/core/index.js");
  const nodeHttp = await import("../dist/adapters/node-http.js");
  const express = await import("../dist/adapters/express.js");
  const koa = await import("../dist/adapters/koa.js");
  const fastify = await import("../dist/adapters/fastify.js");
  const fetch = await import("../dist/adapters/fetch.js");

  expect(packageRoot.BentoS3).toBeDefined();
  expect(core.BentoS3Core).toBeDefined();
  expect(nodeHttp.handleNodeHttpRequest).toBeDefined();
  expect(express.expressAdapter).toBeDefined();
  expect(koa.koaAdapter).toBeDefined();
  expect(fastify.fastifyBentoS3).toBeDefined();
  expect(fetch.handleFetchRequest).toBeDefined();

  await expect(access(join(root, "dist", "index.d.ts"))).resolves.toBeUndefined();
  await expect(access(join(root, "dist", "core", "index.d.ts"))).resolves.toBeUndefined();
  await expect(access(join(root, "dist", "cli", "index.js"))).resolves.toBeUndefined();
});
