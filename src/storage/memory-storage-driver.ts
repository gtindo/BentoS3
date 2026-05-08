import { createHash } from "node:crypto";
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

const EMPTY_PREFIX = "";

interface StoredObject {
  info: ObjectInfo;
  body: Uint8Array;
}

export class MemoryStorageDriver implements StorageDriver {
  private readonly buckets = new Map<string, BucketInfo>();
  private readonly objects = new Map<string, Map<string, StoredObject>>();

  public constructor(buckets: BucketInfo[] = []) {
    for (const bucket of buckets) {
      this.buckets.set(bucket.name, bucket);
      this.objects.set(bucket.name, new Map());
    }
  }

  public listBuckets(): Promise<BucketInfo[]> {
    return Promise.resolve([...this.buckets.values()]);
  }

  public createBucket(name: string): Promise<void> {
    if (this.buckets.has(name)) {
      throw new StorageError("BucketAlreadyExists", "The requested bucket name is already in use.");
    }

    this.buckets.set(name, { name, createdAt: new Date() });
    this.objects.set(name, new Map());
    return Promise.resolve();
  }

  public deleteBucket(name: string): Promise<void> {
    const bucketObjects = this.objects.get(name);

    if (!this.buckets.has(name) || !bucketObjects) {
      throw new StorageError("NoSuchBucket", "The specified bucket does not exist.");
    }

    if (bucketObjects.size > 0) {
      throw new StorageError("BucketNotEmpty", "The bucket you tried to delete is not empty.");
    }

    this.buckets.delete(name);
    this.objects.delete(name);
    return Promise.resolve();
  }

  public headBucket(name: string): Promise<BucketInfo> {
    const bucket = this.buckets.get(name);

    if (!bucket) {
      throw new StorageError("NoSuchBucket", "The specified bucket does not exist.");
    }

    return Promise.resolve(bucket);
  }

  public putObject(input: PutObjectInput): Promise<ObjectInfo> {
    const bucketObjects = this.objects.get(input.bucket);

    if (!this.buckets.has(input.bucket) || !bucketObjects) {
      throw new StorageError("NoSuchBucket", "The specified bucket does not exist.");
    }

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

    bucketObjects.set(input.key, { info, body: new Uint8Array(input.body) });
    return Promise.resolve(info);
  }

  public getObject(bucket: string, key: string): Promise<GetObjectResult> {
    const object = this.readObject(bucket, key);
    return Promise.resolve({ info: object.info, body: new Uint8Array(object.body) });
  }

  public headObject(bucket: string, key: string): Promise<ObjectInfo> {
    return Promise.resolve(this.readObject(bucket, key).info);
  }

  public deleteObject(bucket: string, key: string): Promise<void> {
    const bucketObjects = this.objects.get(bucket);

    if (!this.buckets.has(bucket) || !bucketObjects) {
      throw new StorageError("NoSuchBucket", "The specified bucket does not exist.");
    }

    bucketObjects.delete(key);
    return Promise.resolve();
  }

  public listObjects(input: ListObjectsInput): Promise<ListObjectsResult> {
    const bucketObjects = this.objects.get(input.bucket);

    if (!this.buckets.has(input.bucket) || !bucketObjects) {
      throw new StorageError("NoSuchBucket", "The specified bucket does not exist.");
    }

    const prefix = input.prefix ?? EMPTY_PREFIX;
    const objects = [...bucketObjects.values()]
      .map((object) => object.info)
      .filter((object) => object.key.startsWith(prefix))
      .sort((left, right) => left.key.localeCompare(right.key));

    return Promise.resolve({ objects });
  }

  private readObject(bucket: string, key: string): StoredObject {
    const bucketObjects = this.objects.get(bucket);

    if (!this.buckets.has(bucket) || !bucketObjects) {
      throw new StorageError("NoSuchBucket", "The specified bucket does not exist.");
    }

    const object = bucketObjects.get(key);

    if (!object) {
      throw new StorageError("NoSuchKey", "The specified key does not exist.");
    }

    return object;
  }
}

function createEtag(body: Uint8Array): string {
  return `"${createHash("md5").update(body).digest("hex")}"`;
}
