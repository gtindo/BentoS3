export interface BucketInfo {
  name: string;
  createdAt: Date;
}

export interface ObjectInfo {
  bucket: string;
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
  contentType?: string;
  metadata: Record<string, string>;
}

export interface PutObjectInput {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  info: ObjectInfo;
  body: Uint8Array;
}

export interface ListObjectsInput {
  bucket: string;
  prefix?: string;
}

export interface ListObjectsResult {
  objects: ObjectInfo[];
}

export interface StorageDriver {
  listBuckets(): Promise<BucketInfo[]>;
  createBucket(name: string): Promise<void>;
  deleteBucket(name: string): Promise<void>;
  headBucket(name: string): Promise<BucketInfo>;
  putObject(input: PutObjectInput): Promise<ObjectInfo>;
  getObject(bucket: string, key: string): Promise<GetObjectResult>;
  headObject(bucket: string, key: string): Promise<ObjectInfo>;
  deleteObject(bucket: string, key: string): Promise<void>;
  listObjects(input: ListObjectsInput): Promise<ListObjectsResult>;
}
