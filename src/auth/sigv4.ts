import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { BentoRequest, BentoResponse } from "../core/types.js";
import { createS3ErrorResponse } from "../s3/errors.js";
import type { AuthStore } from "./types.js";

const ALGORITHM_AWS4_HMAC_SHA256 = "AWS4-HMAC-SHA256";
const AUTHORIZATION_PARAMETER_CREDENTIAL = "Credential";
const AUTHORIZATION_PARAMETER_SIGNATURE = "Signature";
const AUTHORIZATION_PARAMETER_SIGNED_HEADERS = "SignedHeaders";
const DATE_SCOPE_LENGTH = 8;
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const HEADER_AUTHORIZATION = "authorization";
const HEADER_X_AMZ_CONTENT_SHA256 = "x-amz-content-sha256";
const HEADER_X_AMZ_DATE = "x-amz-date";
const HEX_ENCODING = "hex";
const HMAC_ALGORITHM = "sha256";
const SERVICE_S3 = "s3";
const SIGNING_KEY_PREFIX = "AWS4";
const SIGNING_REQUEST = "aws4_request";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const X_AMZ_DATE_PATTERN = /^\d{8}T\d{6}Z$/;

interface AuthorizationHeader {
  algorithm: string;
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  terminal: string;
  signedHeaders: string[];
  signature: string;
}

export async function validateS3RequestAuth(
  request: BentoRequest,
  authStore: AuthStore,
): Promise<BentoResponse | undefined> {
  const authorization = getHeader(request, HEADER_AUTHORIZATION);

  if (!authorization) {
    return createAccessDeniedResponse("Missing authorization header.");
  }

  const parsedAuthorization = parseAuthorizationHeader(authorization);

  if (!parsedAuthorization) {
    return createAccessDeniedResponse("Malformed authorization header.");
  }

  if (parsedAuthorization.algorithm !== ALGORITHM_AWS4_HMAC_SHA256) {
    return createAccessDeniedResponse("Unsupported signing algorithm.");
  }

  if (
    parsedAuthorization.service !== SERVICE_S3 ||
    parsedAuthorization.terminal !== SIGNING_REQUEST ||
    parsedAuthorization.date.length !== DATE_SCOPE_LENGTH
  ) {
    return createAccessDeniedResponse("Malformed credential scope.");
  }

  const amzDate = getHeader(request, HEADER_X_AMZ_DATE);

  if (!amzDate || !X_AMZ_DATE_PATTERN.test(amzDate)) {
    return createAccessDeniedResponse("Invalid or missing x-amz-date.");
  }

  if (amzDate.slice(0, DATE_SCOPE_LENGTH) !== parsedAuthorization.date) {
    return createSignatureDoesNotMatchResponse();
  }

  const credential = await authStore.getCredential(parsedAuthorization.accessKeyId);

  if (!credential) {
    return createInvalidAccessKeyResponse();
  }

  if (!credential.enabled) {
    return createAccessDeniedResponse("Access key is disabled.");
  }

  const payloadHash = await getPayloadHash(request);

  if (!payloadHash) {
    return createAccessDeniedResponse("Invalid payload hash.");
  }

  const canonicalHeaders = createCanonicalHeaders(request, parsedAuthorization.signedHeaders);

  if (!canonicalHeaders) {
    return createAccessDeniedResponse("Missing signed header.");
  }

  const credentialScope = [
    parsedAuthorization.date,
    parsedAuthorization.region,
    parsedAuthorization.service,
    parsedAuthorization.terminal,
  ].join("/");
  const canonicalRequest = createCanonicalRequest(
    request,
    canonicalHeaders,
    parsedAuthorization.signedHeaders,
    payloadHash,
  );
  const stringToSign = createStringToSign(amzDate, credentialScope, canonicalRequest);
  const expectedSignature = createSignature(
    credential.secretAccessKey,
    parsedAuthorization.date,
    parsedAuthorization.region,
    stringToSign,
  );

  if (!hasMatchingSignature(expectedSignature, parsedAuthorization.signature)) {
    return createSignatureDoesNotMatchResponse();
  }

  return undefined;
}

export function parseAuthorizationHeader(value: string): AuthorizationHeader | undefined {
  const [algorithm, rawParameters] = splitOnce(value, " ");

  if (!algorithm || !rawParameters) {
    return undefined;
  }

  const parameters = parseAuthorizationParameters(rawParameters);
  const credentialScope = parameters.get(AUTHORIZATION_PARAMETER_CREDENTIAL)?.split("/");
  const signedHeaders = parameters.get(AUTHORIZATION_PARAMETER_SIGNED_HEADERS)?.split(";");
  const signature = parameters.get(AUTHORIZATION_PARAMETER_SIGNATURE);

  if (credentialScope?.length !== 5 || !signedHeaders?.length || !signature) {
    return undefined;
  }

  const [accessKeyId, date, region, service, terminal] = credentialScope;

  if (!accessKeyId || !date || !region || !service || !terminal) {
    return undefined;
  }

  return { algorithm, accessKeyId, date, region, service, terminal, signedHeaders, signature };
}

export function createCanonicalRequest(
  request: BentoRequest,
  canonicalHeaders: string,
  signedHeaders: string[],
  payloadHash: string,
): string {
  const canonicalPath = request.canonicalPath ?? request.path;

  return [
    request.method.toUpperCase(),
    createCanonicalUri(canonicalPath),
    createCanonicalQueryString(request.query),
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
}

export function createCanonicalHeaders(
  request: BentoRequest,
  signedHeaders: string[],
): string | undefined {
  const headers = normalizeHeaders(request.headers);
  const canonicalHeaderLines: string[] = [];

  for (const signedHeader of signedHeaders) {
    const normalizedHeaderName = signedHeader.toLowerCase();
    const value = headers.get(normalizedHeaderName);

    if (value === undefined) {
      return undefined;
    }

    canonicalHeaderLines.push(`${normalizedHeaderName}:${normalizeHeaderValue(value)}\n`);
  }

  return canonicalHeaderLines.join("");
}

export function createCanonicalUri(path: string): string {
  const normalizedPath = path || "/";

  return normalizedPath
    .split("/")
    .map((segment) => encodeUriComponent(decodeUriComponent(segment)))
    .join("/");
}

export function createCanonicalQueryString(query: URLSearchParams): string {
  return [...query.entries()]
    .sort(([leftName, leftValue], [rightName, rightValue]) => {
      const nameComparison = leftName.localeCompare(rightName);

      return nameComparison === 0 ? leftValue.localeCompare(rightValue) : nameComparison;
    })
    .map(([name, value]) => `${encodeUriComponent(name)}=${encodeUriComponent(value)}`)
    .join("&");
}

export async function getPayloadHash(request: BentoRequest): Promise<string | undefined> {
  const signedPayloadHash = getHeader(request, HEADER_X_AMZ_CONTENT_SHA256);

  if (signedPayloadHash === UNSIGNED_PAYLOAD) {
    return UNSIGNED_PAYLOAD;
  }

  if (!request.body) {
    const payloadHash = signedPayloadHash ?? EMPTY_HASH;

    return payloadHash === EMPTY_HASH ? payloadHash : undefined;
  }

  const body = await readRequestBody(request.body);
  const actualPayloadHash = createHash(HMAC_ALGORITHM).update(body).digest(HEX_ENCODING);
  request.body = createBufferedBody(body);

  if (signedPayloadHash && signedPayloadHash !== actualPayloadHash) {
    return undefined;
  }

  return signedPayloadHash ?? actualPayloadHash;
}

function createBufferedBody(body: Uint8Array): NodeJS.ReadableStream {
  return Readable.from([body]);
}

function parseAuthorizationParameters(value: string): Map<string, string> {
  const parameters = new Map<string, string>();

  for (const rawParameter of value.split(",")) {
    const [name, parameterValue] = splitOnce(rawParameter.trim(), "=");

    if (name && parameterValue) {
      parameters.set(name, parameterValue);
    }
  }

  return parameters;
}

function createStringToSign(date: string, credentialScope: string, canonicalRequest: string): string {
  return [
    ALGORITHM_AWS4_HMAC_SHA256,
    date,
    credentialScope,
    createHash(HMAC_ALGORITHM).update(canonicalRequest).digest(HEX_ENCODING),
  ].join("\n");
}

function createSignature(
  secretAccessKey: string,
  date: string,
  region: string,
  stringToSign: string,
): string {
  const dateKey = createHmac(HMAC_ALGORITHM, `${SIGNING_KEY_PREFIX}${secretAccessKey}`).update(date).digest();
  const regionKey = createHmac(HMAC_ALGORITHM, dateKey).update(region).digest();
  const serviceKey = createHmac(HMAC_ALGORITHM, regionKey).update(SERVICE_S3).digest();
  const signingKey = createHmac(HMAC_ALGORITHM, serviceKey).update(SIGNING_REQUEST).digest();

  return createHmac(HMAC_ALGORITHM, signingKey).update(stringToSign).digest(HEX_ENCODING);
}

function hasMatchingSignature(expectedSignature: string, actualSignature: string): boolean {
  const expected = Buffer.from(expectedSignature, HEX_ENCODING);
  const actual = Buffer.from(actualSignature, HEX_ENCODING);

  if (expected.byteLength !== actual.byteLength) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

async function readRequestBody(body: NonNullable<BentoRequest["body"]>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of body) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
    );
  }

  return Buffer.concat(chunks);
}

function normalizeHeaders(
  headers: BentoRequest["headers"],
): Map<string, string> {
  const normalizedHeaders = new Map<string, string>();

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    normalizedHeaders.set(name.toLowerCase(), Array.isArray(value) ? value.join(",") : value);
  }

  return normalizedHeaders;
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getHeader(request: BentoRequest, name: string): string | undefined {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return value;
}

function encodeUriComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

function decodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const separatorIndex = value.indexOf(separator);

  if (separatorIndex === -1) {
    return [value, undefined];
  }

  return [value.slice(0, separatorIndex), value.slice(separatorIndex + separator.length)];
}

function createAccessDeniedResponse(message: string): BentoResponse {
  return createS3ErrorResponse({ code: "AccessDenied", message, statusCode: 403 });
}

function createInvalidAccessKeyResponse(): BentoResponse {
  return createS3ErrorResponse({
    code: "InvalidAccessKeyId",
    message: "The AWS access key ID you provided does not exist in our records.",
    statusCode: 403,
  });
}

function createSignatureDoesNotMatchResponse(): BentoResponse {
  return createS3ErrorResponse({
    code: "SignatureDoesNotMatch",
    message: "The request signature we calculated does not match the signature you provided.",
    statusCode: 403,
  });
}
