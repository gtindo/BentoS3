import { mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileSystemStorageDriver } from "../file-system-storage-driver.js";
import { StorageError } from "../errors.js";

const TEST_ROOT_PREFIX = "bento-s3-storage-";
const TEST_BUCKET = "photos";

describe("FileSystemStorageDriver", () => {
  it("persists bucket and object bytes with metadata sidecars", async () => {
    const rootDir = await createTempRoot();
    const storage = new FileSystemStorageDriver({ rootDir });
    const body = new TextEncoder().encode("hello storage");

    await storage.createBucket(TEST_BUCKET);
    const object = await storage.putObject({
      bucket: TEST_BUCKET,
      key: "cats/leo.txt",
      body,
      contentType: "text/plain",
      metadata: { source: "unit-test" },
    });

    const objectPath = join(rootDir, ".bentos3", "buckets", TEST_BUCKET, "cats", "leo.txt");
    const metadataPath = `${objectPath}.meta.json`;

    await expect(readFile(objectPath)).resolves.toEqual(Buffer.from(body));
    await expect(readFile(metadataPath, "utf8")).resolves.toContain("unit-test");
    expect(object.contentType).toBe("text/plain");
  });

  it("loads persisted objects from a new driver instance", async () => {
    const rootDir = await createTempRoot();
    const firstStorage = new FileSystemStorageDriver({ rootDir });

    await firstStorage.createBucket(TEST_BUCKET);
    await firstStorage.putObject({
      bucket: TEST_BUCKET,
      key: "cats/leo.txt",
      body: new TextEncoder().encode("persistent"),
      metadata: { color: "orange" },
    });

    const secondStorage = new FileSystemStorageDriver({ rootDir });
    const object = await secondStorage.getObject(TEST_BUCKET, "cats/leo.txt");

    expect(new TextDecoder().decode(object.body)).toBe("persistent");
    expect(object.info.metadata.color).toBe("orange");
  });

  it("rejects object keys that attempt path traversal", async () => {
    const rootDir = await createTempRoot();
    const storage = new FileSystemStorageDriver({ rootDir });

    await storage.createBucket(TEST_BUCKET);

    await expect(
      storage.putObject({
        bucket: TEST_BUCKET,
        key: "../outside.txt",
        body: new TextEncoder().encode("unsafe"),
      }),
    ).rejects.toBeInstanceOf(StorageError);

    await expect(stat(join(rootDir, ".bentos3", "buckets", "outside.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function createTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), TEST_ROOT_PREFIX));
}
