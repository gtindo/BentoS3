export type StorageErrorCode =
  | "BucketAlreadyExists"
  | "InvalidBucketName"
  | "BucketNotEmpty"
  | "InvalidObjectKey"
  | "NoSuchBucket"
  | "NoSuchKey";

export class StorageError extends Error {
  public readonly code: StorageErrorCode;

  public constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}
