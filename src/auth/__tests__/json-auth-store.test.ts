import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonAuthStore } from "../json-auth-store.js";

const TEST_ACCESS_KEY_ID = "test";
const TEST_ROOT_PREFIX = "bento-s3-auth-";
const TEST_SECRET_ACCESS_KEY = "test-secret";

describe("JsonAuthStore", () => {
  it("creates and lists credentials", async () => {
    const rootDir = await createTempRoot();
    const authStore = new JsonAuthStore({ rootDir });

    const credential = await authStore.createCredential({
      accessKeyId: TEST_ACCESS_KEY_ID,
      secretAccessKey: TEST_SECRET_ACCESS_KEY,
    });
    const credentials = await authStore.listCredentials();

    expect(credential.enabled).toBe(true);
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.accessKeyId).toBe(TEST_ACCESS_KEY_ID);
  });

  it("disables credentials", async () => {
    const rootDir = await createTempRoot();
    const authStore = new JsonAuthStore({ rootDir });

    await authStore.createCredential({
      accessKeyId: TEST_ACCESS_KEY_ID,
      secretAccessKey: TEST_SECRET_ACCESS_KEY,
    });
    await authStore.disableCredential(TEST_ACCESS_KEY_ID);

    const credential = await authStore.getCredential(TEST_ACCESS_KEY_ID);

    expect(credential?.enabled).toBe(false);
    expect(credential?.disabledAt).toBeInstanceOf(Date);
  });

  it("deletes credentials", async () => {
    const rootDir = await createTempRoot();
    const authStore = new JsonAuthStore({ rootDir });

    await authStore.createCredential({
      accessKeyId: TEST_ACCESS_KEY_ID,
      secretAccessKey: TEST_SECRET_ACCESS_KEY,
    });
    await authStore.deleteCredential(TEST_ACCESS_KEY_ID);

    await expect(authStore.getCredential(TEST_ACCESS_KEY_ID)).resolves.toBeUndefined();
  });

  it("persists credentials across store re-instantiation", async () => {
    const rootDir = await createTempRoot();
    const firstStore = new JsonAuthStore({ rootDir });
    await firstStore.createCredential({
      accessKeyId: TEST_ACCESS_KEY_ID,
      secretAccessKey: TEST_SECRET_ACCESS_KEY,
    });

    const secondStore = new JsonAuthStore({ rootDir });
    const credentialsFile = join(rootDir, ".bentos3", "auth", "credentials.json");

    await expect(secondStore.getCredential(TEST_ACCESS_KEY_ID)).resolves.toMatchObject({
      accessKeyId: TEST_ACCESS_KEY_ID,
      secretAccessKey: TEST_SECRET_ACCESS_KEY,
      enabled: true,
    });
    await expect(readFile(credentialsFile, "utf8")).resolves.toContain(TEST_ACCESS_KEY_ID);
  });
});

async function createTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), TEST_ROOT_PREFIX));
}
