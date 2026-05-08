import type { BentoResponse } from "../core/types.js";
import { createXmlDocument, createXmlElement } from "./xml.js";

const CONTENT_TYPE_XML = "application/xml";
const REQUEST_ID = "0000000000000000";

export type S3ErrorCode =
  | "BucketAlreadyExists"
  | "MethodNotAllowed"
  | "NoSuchBucket"
  | "NotImplemented";

export interface S3ErrorDefinition {
  code: S3ErrorCode;
  message: string;
  statusCode: number;
}

export function createS3ErrorResponse(error: S3ErrorDefinition): BentoResponse {
  const body = createXmlDocument(
    `<Error>${createXmlElement("Code", error.code)}${createXmlElement(
      "Message",
      error.message,
    )}${createXmlElement("RequestId", REQUEST_ID)}</Error>`,
  );

  return {
    statusCode: error.statusCode,
    headers: {
      "content-type": CONTENT_TYPE_XML,
      "x-amz-request-id": REQUEST_ID,
    },
    body,
  };
}

export function createNotImplementedResponse(message: string): BentoResponse {
  return createS3ErrorResponse({ code: "NotImplemented", message, statusCode: 501 });
}
