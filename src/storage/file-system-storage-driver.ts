import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type {
  BucketInfo,
  GetObjectResult,
  ListObjectsInput,
  ListObjectsResult,
  ObjectInfo,
  PutObjectInput,
  StorageDriver,
} from "./types.js";
import { StorageError } from "./errors.js";

const BENTO_ROOT_DIRECTORY = ".bentos3";
const BUCKETS_DIRECTORY = "buckets";
const TEMP_DIRECTORY = "tmp";
const BUCKET_METADATA_FILE = ".bentos3-bucket.json";
const OBJECT_METADATA_SUFFIX = ".meta.json";
const JSON_INDENT = 2;
const EMPTY_PREFIX = "";

interface FileSystemStorageDriverOptions {
  rootDir: string;
}

interface BucketMetadataFile {
  name: string;
  createdAt: string;
}

interface ObjectMetadataFile {
  key: string;
  size: number;
  etag: string;
  lastModified: string;
  contentType?: string;
  metadata: Record<string, string>;
}

export class FileSystemStorageDriver implements StorageDriver {
  private readonly rootDir: string;
  private readonly bucketsDir: string;
  private readonly tmpDir: string;

  public constructor(options: FileSystemStorageDriverOptions) {
    this.rootDir = resolve(options.rootDir, BENTO_ROOT_DIRECTORY);
    this.bucketsDir = join(this.rootDir, BUCKETS_DIRECTORY);
    this.tmpDir = join(this.rootDir, TEMP_DIRECTORY);
  }

  public async listBuckets(): Promise<BucketInfo[]> {
    await this.ensureRootDirectories();

    const entries = await readdir(this.bucketsDir, { withFileTypes: true });
    const buckets = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readBucketInfo(entry.name)),
    );

    return buckets.sort((left, right) => left.name.localeCompare(right.name));
  }

  public async createBucket(name: string): Promise<void> {
    await this.ensureRootDirectories();
    validateBucketName(name);

    const bucketPath = this.getBucketPath(name);

    try {
      await mkdir(bucketPath);
    } catch (error) {
      if (isNodeErrorCode(error, "EEXIST")) {
        throw new StorageError(
          "BucketAlreadyExists",
          "The requested bucket name is already in use.",
        );
      }

      throw error;
    }

    const metadata: BucketMetadataFile = { name, createdAt: new Date().toISOString() };
    await writeJsonFile(this.getBucketMetadataPath(name), metadata);
  }

  public async deleteBucket(name: string): Promise<void> {
    await this.headBucket(name);

    const entries = await readdir(this.getBucketPath(name));
    const visibleEntries = entries.filter((entry) => entry !== BUCKET_METADATA_FILE);

    if (visibleEntries.length > 0) {
      throw new StorageError("BucketNotEmpty", "The bucket you tried to delete is not empty.");
    }

    await rm(this.getBucketPath(name), { recursive: true });
  }

  public async headBucket(name: string): Promise<BucketInfo> {
    try {
      return await this.readBucketInfo(name);
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        throw new StorageError("NoSuchBucket", "The specified bucket does not exist.");
      }

      throw error;
    }
  }

  public async putObject(input: PutObjectInput): Promise<ObjectInfo> {
    await this.headBucket(input.bucket);

    const objectPath = this.getSafeObjectPath(input.bucket, input.key);
    const metadataPath = this.getObjectMetadataPath(objectPath);
    const metadata = input.metadata ?? {};
    const info: ObjectInfo = {
      bucket: input.bucket,
      key: input.key,
      size: input.body.byteLength,
      etag: createEtag(input.body),
      lastModified: new Date(),
      metadata,
      ...(input.contentType ? { contentType: input.contentType } : {}),
    };

    await mkdir(dirname(objectPath), { recursive: true });
    await writeFileAtomically(this.tmpDir, objectPath, input.body);
    await writeJsonFile(metadataPath, serializeObjectInfo(info));

    return info;
  }

  public async getObject(bucket: string, key: string): Promise<GetObjectResult> {
    const info = await this.headObject(bucket, key);
    const body = await readFile(this.getSafeObjectPath(bucket, key));

    return { info, body };
  }

  public async headObject(bucket: string, key: string): Promise<ObjectInfo> {
    await this.headBucket(bucket);

    const objectPath = this.getSafeObjectPath(bucket, key);

    try {
      const metadata = await readJsonFile<ObjectMetadataFile>(
        this.getObjectMetadataPath(objectPath),
      );
      return deserializeObjectInfo(bucket, metadata);
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        throw new StorageError("NoSuchKey", "The specified key does not exist.");
      }

      throw error;
    }
  }

  public async deleteObject(bucket: string, key: string): Promise<void> {
    await this.headBucket(bucket);

    const objectPath = this.getSafeObjectPath(bucket, key);
    await rm(objectPath, { force: true });
    await rm(this.getObjectMetadataPath(objectPath), { force: true });
    await removeEmptyObjectDirectories(dirname(objectPath), this.getBucketPath(bucket));
  }

  public async listObjects(input: ListObjectsInput): Promise<ListObjectsResult> {
    await this.headBucket(input.bucket);

    const prefix = input.prefix ?? EMPTY_PREFIX;
    const metadataPaths = await this.listObjectMetadataPaths(this.getBucketPath(input.bucket));
    const objects = await Promise.all(
      metadataPaths.map(async (metadataPath) => {
        const metadata = await readJsonFile<ObjectMetadataFile>(metadataPath);
        return deserializeObjectInfo(input.bucket, metadata);
      }),
    );

    return {
      objects: objects
        .filter((object) => object.key.startsWith(prefix))
        .sort((left, right) => left.key.localeCompare(right.key)),
    };
  }

  private async ensureRootDirectories(): Promise<void> {
    await mkdir(this.bucketsDir, { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
  }

  private async readBucketInfo(name: string): Promise<BucketInfo> {
    validateBucketName(name);

    const metadata = await readJsonFile<BucketMetadataFile>(this.getBucketMetadataPath(name));
    return { name: metadata.name, createdAt: new Date(metadata.createdAt) };
  }

  private getBucketPath(name: string): string {
    return join(this.bucketsDir, name);
  }

  private getBucketMetadataPath(name: string): string {
    return join(this.getBucketPath(name), BUCKET_METADATA_FILE);
  }

  private getSafeObjectPath(bucket: string, key: string): string {
    validateObjectKey(key);

    const bucketPath = this.getBucketPath(bucket);
    const objectPath = resolve(bucketPath, key);
    const pathFromBucket = relative(bucketPath, objectPath);
    const resolvesOutsideBucket = pathFromBucket.startsWith(`..${sep}`) || pathFromBucket === "..";

    if (resolvesOutsideBucket || isAbsolute(pathFromBucket)) {
      throw new StorageError(
        "InvalidObjectKey",
        "Object key resolves outside the bucket directory.",
      );
    }

    return objectPath;
  }

  private getObjectMetadataPath(objectPath: string): string {
    return `${objectPath}${OBJECT_METADATA_SUFFIX}`;
  }

  private async listObjectMetadataPaths(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const paths: string[] = [];

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        paths.push(...(await this.listObjectMetadataPaths(entryPath)));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(OBJECT_METADATA_SUFFIX)) {
        paths.push(entryPath);
      }
    }

    return paths;
  }
}

export function validateBucketName(name: string): void {
  const normalizedName = normalize(name);
  const segments = normalizedName.split(sep);
  const containsPathSeparator = name.includes("/") || name.includes("\\");

  if (
    name.length === 0 ||
    isAbsolute(name) ||
    containsPathSeparator ||
    segments.includes("..") ||
    normalizedName === "." ||
    normalizedName !== name
  ) {
    throw new StorageError("InvalidBucketName", "Bucket name is not safe to store on disk.");
  }
}

function validateObjectKey(key: string): void {
  const normalizedKey = normalize(key);
  const segments = normalizedKey.split(sep);
  const targetsBucketMetadata = normalizedKey === BUCKET_METADATA_FILE;

  if (key.length === 0 || isAbsolute(key) || segments.includes("..") || targetsBucketMetadata) {
    throw new StorageError("InvalidObjectKey", "Object key is not safe to store on disk.");
  }
}

function serializeObjectInfo(info: ObjectInfo): ObjectMetadataFile {
  return {
    key: info.key,
    size: info.size,
    etag: info.etag,
    lastModified: info.lastModified.toISOString(),
    metadata: info.metadata,
    ...(info.contentType ? { contentType: info.contentType } : {}),
  };
}

function deserializeObjectInfo(bucket: string, metadata: ObjectMetadataFile): ObjectInfo {
  return {
    bucket,
    key: metadata.key,
    size: metadata.size,
    etag: metadata.etag,
    lastModified: new Date(metadata.lastModified),
    metadata: metadata.metadata,
    ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
  };
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeFileAtomically(
  tmpDir: string,
  destinationPath: string,
  body: Uint8Array,
): Promise<void> {
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, randomUUID());

  await writeFile(tmpPath, body);
  await rename(tmpPath, destinationPath);
}

function createEtag(body: Uint8Array): string {
  return `"${createHash("md5").update(body).digest("hex")}"`;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function removeEmptyObjectDirectories(directory: string, bucketPath: string): Promise<void> {
  if (directory === bucketPath) {
    return;
  }

  try {
    await rmdir(directory);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOTEMPTY") || isNodeErrorCode(error, "ENOENT")) {
      return;
    }

    throw error;
  }

  await removeEmptyObjectDirectories(dirname(directory), bucketPath);
}
