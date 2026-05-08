import type { BentoResponse } from "../core/types.js";
import type { S3Route } from "../core/router.js";
import { createS3ErrorResponse } from "./errors.js";
import { createXmlDocument, createXmlElement } from "./xml.js";

const CONTENT_TYPE_XML = "application/xml";
const EMPTY_RESPONSE_BODY = "";
const LIST_BUCKETS_RESULT_XMLNS = "http://s3.amazonaws.com/doc/2006-03-01/";
const METHOD_GET = "GET";
const METHOD_HEAD = "HEAD";
const METHOD_PUT = "PUT";
const ROOT_USER_ID = "bento-s3";
const ROOT_USER_DISPLAY_NAME = "bento-s3";

export interface BucketRecord {
  name: string;
  createdAt: Date;
}

export function handleS3Request(
  method: string,
  route: S3Route,
  buckets: Map<string, BucketRecord>,
): BentoResponse {
  if (method === METHOD_GET && !route.bucket && !route.key) {
    return createListBucketsResponse([...buckets.values()]);
  }

  if (method === METHOD_PUT && route.bucket && !route.key) {
    return createBucket(route.bucket, buckets);
  }

  if (method === METHOD_HEAD && route.bucket && !route.key) {
    return createHeadBucketResponse(route.bucket, buckets);
  }

  return createS3ErrorResponse({
    code: "MethodNotAllowed",
    message: "The specified method is not allowed against this resource.",
    statusCode: 405,
  });
}

export function createListBucketsResponse(buckets: BucketRecord[]): BentoResponse {
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

export function createBucket(
  bucketName: string,
  buckets: Map<string, BucketRecord>,
): BentoResponse {
  if (buckets.has(bucketName)) {
    return createS3ErrorResponse({
      code: "BucketAlreadyExists",
      message: "The requested bucket name is already in use.",
      statusCode: 409,
    });
  }

  buckets.set(bucketName, { name: bucketName, createdAt: new Date() });

  return {
    statusCode: 200,
    headers: {
      location: `/${bucketName}`,
    },
    body: EMPTY_RESPONSE_BODY,
  };
}

export function createHeadBucketResponse(
  bucketName: string,
  buckets: Map<string, BucketRecord>,
): BentoResponse {
  if (!buckets.has(bucketName)) {
    return {
      ...createS3ErrorResponse({
        code: "NoSuchBucket",
        message: "The specified bucket does not exist.",
        statusCode: 404,
      }),
      body: EMPTY_RESPONSE_BODY,
    };
  }

  return {
    statusCode: 200,
    headers: {},
    body: EMPTY_RESPONSE_BODY,
  };
}
