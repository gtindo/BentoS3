import type { BentoRequest, BentoResponse } from "../core/types.js";
import type { S3Route } from "../core/router.js";
import { createS3ErrorResponse } from "./errors.js";
import { createXmlDocument, createXmlElement } from "./xml.js";
import type { BucketInfo, ObjectInfo, StorageDriver } from "../storage/types.js";
import { isStorageError, StorageError } from "../storage/errors.js";

const CONTENT_TYPE_XML = "application/xml";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const EMPTY_RESPONSE_BODY = "";
const LIST_BUCKETS_RESULT_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
const LIST_OBJECTS_RESULT_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
const HEADER_CONTENT_TYPE = "content-type";
const HEADER_COPY_SOURCE = "x-amz-copy-source";
const HEADER_ETAG = "etag";
const HEADER_LAST_MODIFIED = "last-modified";
const HEADER_METADATA_PREFIX = "x-amz-meta-";
const METHOD_DELETE = "DELETE";
const METHOD_GET = "GET";
const METHOD_HEAD = "HEAD";
const METHOD_POST = "POST";
const METHOD_PUT = "PUT";
const QUERY_DELETE = "delete";
const QUERY_LIST_TYPE = "list-type";
const QUERY_PREFIX = "prefix";
const ROOT_USER_ID = "bento-s3";
const ROOT_USER_DISPLAY_NAME = "bento-s3";
const S3_LIST_OBJECTS_V2_TYPE = "2";

interface DeleteObjectRequest {
  key: string;
}

export async function handleS3Request(
  request: BentoRequest,
  route: S3Route,
  storage: StorageDriver,
): Promise<BentoResponse> {
  const method = request.method.toUpperCase();

  try {
    if (method === METHOD_GET && !route.bucket && !route.key) {
      return createListBucketsResponse(await storage.listBuckets());
    }

    if (method === METHOD_PUT && route.bucket && !route.key) {
      await storage.createBucket(route.bucket);
      return createBucketResponse(route.bucket);
    }

    if (method === METHOD_HEAD && route.bucket && !route.key) {
      await storage.headBucket(route.bucket);
      return createEmptyResponse();
    }

    if (method === METHOD_DELETE && route.bucket && !route.key) {
      await storage.deleteBucket(route.bucket);
      return createEmptyResponse(204);
    }

    if (
      method === METHOD_GET &&
      route.bucket &&
      request.query.get(QUERY_LIST_TYPE) === S3_LIST_OBJECTS_V2_TYPE
    ) {
      const prefix = request.query.get(QUERY_PREFIX) ?? "";
      return createListObjectsV2Response(
        route.bucket,
        prefix,
        await storage.listObjects(
          prefix ? { bucket: route.bucket, prefix } : { bucket: route.bucket },
        ),
      );
    }

    if (
      method === METHOD_PUT &&
      route.bucket &&
      route.key &&
      hasHeader(request, HEADER_COPY_SOURCE)
    ) {
      return await handleCopyObjectRequest(request, route.bucket, route.key, storage);
    }

    if (method === METHOD_PUT && route.bucket && route.key) {
      return await handlePutObjectRequest(request, route.bucket, route.key, storage);
    }

    if (method === METHOD_GET && route.bucket && route.key) {
      const object = await storage.getObject(route.bucket, route.key);
      return createGetObjectResponse(object.info, object.body);
    }

    if (method === METHOD_HEAD && route.bucket && route.key) {
      return createHeadObjectResponse(await storage.headObject(route.bucket, route.key));
    }

    if (method === METHOD_DELETE && route.bucket && route.key) {
      await storage.deleteObject(route.bucket, route.key);
      return createEmptyResponse(204);
    }

    if (method === METHOD_POST && route.bucket && !route.key && request.query.has(QUERY_DELETE)) {
      return await handleDeleteObjectsRequest(request, route.bucket, storage);
    }

    return createMethodNotAllowedResponse();
  } catch (error) {
    return createErrorResponse(error);
  }
}

export function createListBucketsResponse(buckets: BucketInfo[]): BentoResponse {
  const bucketElements = buckets
    .map((bucket) => {
      return `<Bucket>${createXmlElement("Name", bucket.name)}${createXmlElement(
        "CreationDate",
        bucket.createdAt.toISOString(),
      )}</Bucket>`;
    })
    .join("");

  const ownerElement = `<Owner>${createXmlElement("ID", ROOT_USER_ID)}${createXmlElement(
    "DisplayName",
    ROOT_USER_DISPLAY_NAME,
  )}</Owner>`;
  const body = createXmlDocument(
    `<ListAllMyBucketsResult xmlns="${LIST_BUCKETS_RESULT_XMLNS}">${ownerElement}<Buckets>${bucketElements}</Buckets></ListAllMyBucketsResult>`,
  );

  return {
    statusCode: 200,
    headers: {
      "content-type": CONTENT_TYPE_XML,
    },
    body,
  };
}

function createBucketResponse(bucketName: string): BentoResponse {
  return {
    statusCode: 200,
    headers: {
      location: `/${bucketName}`,
    },
    body: EMPTY_RESPONSE_BODY,
  };
}

async function handlePutObjectRequest(
  request: BentoRequest,
  bucket: string,
  key: string,
  storage: StorageDriver,
): Promise<BentoResponse> {
  const body = await readRequestBody(request.body);
  const contentType = getHeader(request, HEADER_CONTENT_TYPE);
  const info = await storage.putObject({
    bucket,
    key,
    body,
    metadata: readUserMetadata(request),
    ...(contentType ? { contentType } : {}),
  });

  return {
    statusCode: 200,
    headers: {
      [HEADER_ETAG]: info.etag,
    },
    body: EMPTY_RESPONSE_BODY,
  };
}

async function handleCopyObjectRequest(
  request: BentoRequest,
  destinationBucket: string,
  destinationKey: string,
  storage: StorageDriver,
): Promise<BentoResponse> {
  const copySource = parseCopySource(getHeader(request, HEADER_COPY_SOURCE));
  const sourceObject = await storage.getObject(copySource.bucket, copySource.key);
  const copiedObject = await storage.putObject({
    bucket: destinationBucket,
    key: destinationKey,
    body: sourceObject.body,
    metadata: sourceObject.info.metadata,
    ...(sourceObject.info.contentType ? { contentType: sourceObject.info.contentType } : {}),
  });
  const body = createXmlDocument(
    `<CopyObjectResult>${createXmlElement("LastModified", copiedObject.lastModified.toISOString())}${createXmlElement(
      "ETag",
      copiedObject.etag,
    )}</CopyObjectResult>`,
  );

  return {
    statusCode: 200,
    headers: {
      "content-type": CONTENT_TYPE_XML,
    },
    body,
  };
}

async function handleDeleteObjectsRequest(
  request: BentoRequest,
  bucket: string,
  storage: StorageDriver,
): Promise<BentoResponse> {
  const body = await readRequestBody(request.body);
  const deleteRequests = parseDeleteObjectsRequest(new TextDecoder().decode(body));

  for (const deleteRequest of deleteRequests) {
    await storage.deleteObject(bucket, deleteRequest.key);
  }

  const deletedElements = deleteRequests
    .map((deleteRequest) => `<Deleted>${createXmlElement("Key", deleteRequest.key)}</Deleted>`)
    .join("");
  const responseBody = createXmlDocument(`<DeleteResult>${deletedElements}</DeleteResult>`);

  return {
    statusCode: 200,
    headers: {
      "content-type": CONTENT_TYPE_XML,
    },
    body: responseBody,
  };
}

function createGetObjectResponse(info: ObjectInfo, body: Uint8Array): BentoResponse {
  return {
    statusCode: 200,
    headers: createObjectHeaders(info),
    body,
  };
}

function createHeadObjectResponse(info: ObjectInfo): BentoResponse {
  return {
    statusCode: 200,
    headers: createObjectHeaders(info),
    body: EMPTY_RESPONSE_BODY,
  };
}

function createObjectHeaders(info: ObjectInfo): Record<string, string | number> {
  const headers: Record<string, string | number> = {
    "content-length": info.size,
    [HEADER_CONTENT_TYPE]: info.contentType ?? DEFAULT_CONTENT_TYPE,
    [HEADER_ETAG]: info.etag,
    [HEADER_LAST_MODIFIED]: info.lastModified.toUTCString(),
  };

  for (const [name, value] of Object.entries(info.metadata)) {
    headers[`${HEADER_METADATA_PREFIX}${name}`] = value;
  }

  return headers;
}

function createListObjectsV2Response(
  bucket: string,
  prefix: string,
  result: { objects: ObjectInfo[] },
): BentoResponse {
  const contents = result.objects
    .map((object) => {
      return `<Contents>${createXmlElement("Key", object.key)}${createXmlElement(
        "LastModified",
        object.lastModified.toISOString(),
      )}${createXmlElement("ETag", object.etag)}${createXmlElement("Size", String(object.size))}</Contents>`;
    })
    .join("");
  const body = createXmlDocument(
    `<ListBucketResult xmlns="${LIST_OBJECTS_RESULT_XMLNS}">${createXmlElement(
      "Name",
      bucket,
    )}${createXmlElement("Prefix", prefix)}${createXmlElement("KeyCount", String(result.objects.length))}${createXmlElement(
      "MaxKeys",
      "1000",
    )}${createXmlElement("IsTruncated", "false")}${contents}</ListBucketResult>`,
  );

  return {
    statusCode: 200,
    headers: {
      "content-type": CONTENT_TYPE_XML,
    },
    body,
  };
}

function createEmptyResponse(statusCode = 200): BentoResponse {
  return { statusCode, headers: {}, body: EMPTY_RESPONSE_BODY };
}

function createErrorResponse(error: unknown): BentoResponse {
  if (!isStorageError(error)) {
    throw error;
  }

  if (error.code === "BucketAlreadyExists") {
    return createS3ErrorResponse({
      code: "BucketAlreadyExists",
      message: error.message,
      statusCode: 409,
    });
  }

  if (error.code === "BucketNotEmpty") {
    return createS3ErrorResponse({
      code: "BucketNotEmpty",
      message: error.message,
      statusCode: 409,
    });
  }

  if (error.code === "InvalidObjectKey") {
    return createS3ErrorResponse({
      code: "InvalidRequest",
      message: error.message,
      statusCode: 400,
    });
  }

  if (error.code === "NoSuchBucket") {
    return createS3ErrorResponse({ code: "NoSuchBucket", message: error.message, statusCode: 404 });
  }

  return createS3ErrorResponse({ code: "NoSuchKey", message: error.message, statusCode: 404 });
}

function createMethodNotAllowedResponse(): BentoResponse {
  return createS3ErrorResponse({
    code: "MethodNotAllowed",
    message: "The specified method is not allowed against this resource.",
    statusCode: 405,
  });
}

async function readRequestBody(body: BentoRequest["body"]): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];

  for await (const chunk of body) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
    );
  }

  return Buffer.concat(chunks);
}

function readUserMetadata(request: BentoRequest): Record<string, string> {
  const metadata: Record<string, string> = {};

  for (const [name, value] of Object.entries(request.headers)) {
    const normalizedName = name.toLowerCase();

    if (!normalizedName.startsWith(HEADER_METADATA_PREFIX)) {
      continue;
    }

    const metadataName = normalizedName.slice(HEADER_METADATA_PREFIX.length);
    const metadataValue = Array.isArray(value) ? value.join(",") : value;

    if (metadataValue !== undefined) {
      metadata[metadataName] = metadataValue;
    }
  }

  return metadata;
}

function hasHeader(request: BentoRequest, name: string): boolean {
  return getHeader(request, name) !== undefined;
}

function getHeader(request: BentoRequest, name: string): string | undefined {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function parseCopySource(value: string | undefined): { bucket: string; key: string } {
  if (!value) {
    throw new StorageError("InvalidObjectKey", "Copy source is required.");
  }

  const source = decodeURIComponent(value.startsWith("/") ? value.slice(1) : value);
  const [bucket, ...keyParts] = source.split("/");
  const key = keyParts.join("/");

  if (!bucket || !key) {
    throw new StorageError("InvalidObjectKey", "Copy source must include bucket and key.");
  }

  return { bucket, key };
}

function parseDeleteObjectsRequest(body: string): DeleteObjectRequest[] {
  const keyPattern = /<Key>(.*?)<\/Key>/gs;
  const keys = [...body.matchAll(keyPattern)].map((match) => unescapeXml(match[1] ?? ""));

  return keys.map((key) => ({ key }));
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
