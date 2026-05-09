import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { AuthStore } from "../auth/types.js";
import type { BentoHandler, BentoRequest, BentoResponse } from "../core/types.js";
import { StorageError } from "../storage/errors.js";
import type { StorageDriver } from "../storage/types.js";
import { JsonDashboardStore, type DashboardUser } from "./json-dashboard-store.js";

const CONTENT_TYPE_CSS = "text/css; charset=utf-8";
const CONTENT_TYPE_HTML = "text/html; charset=utf-8";
const CONTENT_TYPE_JAVASCRIPT = "text/javascript; charset=utf-8";
const CONTENT_TYPE_OCTET_STREAM = "application/octet-stream";
const COOKIE_SESSION = "bentos3_session";
const HEADER_CONTENT_TYPE = "content-type";
const HEADER_COOKIE = "cookie";
const HEADER_LOCATION = "location";
const MULTIPART_BOUNDARY_PREFIX = "boundary=";
const METHOD_GET = "GET";
const METHOD_POST = "POST";
const OBJECTS_PATH_MARKER = "/objects/";
const ROOT_UI_PATH = "/ui";
const STATIC_PATH_PREFIX = "/ui/static/";
const TEMPLATE_EXTENSION = ".ejs";
const VENDOR_TURBO_STATIC_PATH = "/ui/static/vendor/turbo.es2017-esm.js";
const requireFromDashboard = createRequire(import.meta.url);
const TEMPLATE_ROOT_DIR = resolve(fileURLToPath(new URL("./templates/", import.meta.url)));
const STATIC_ROOT_DIR = resolve(fileURLToPath(new URL("./static/", import.meta.url)));
const TURBO_PACKAGE_BUNDLE_PATH = requireFromDashboard.resolve(
  "@hotwired/turbo/dist/turbo.es2017-esm.js",
);
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".css": CONTENT_TYPE_CSS,
  ".js": CONTENT_TYPE_JAVASCRIPT,
};

export interface DashboardRouterOptions {
  authStore: AuthStore;
  dashboardStore: JsonDashboardStore;
  storage: StorageDriver;
}

interface DashboardContext {
  user?: DashboardUser;
}

interface UploadFormData {
  bucket: string;
  key: string;
  body: Uint8Array;
}

interface MultipartPart {
  name: string;
  filename?: string;
  body: Uint8Array;
}

interface RenderPageInput {
  title: string;
  template: string;
  context: DashboardContext;
  activePath?: string;
  data?: TemplateData;
}

type TemplateData = Record<string, unknown>;

export class DashboardRouter implements BentoHandler {
  private readonly authStore: AuthStore;
  private readonly dashboardStore: JsonDashboardStore;
  private readonly storage: StorageDriver;

  public constructor(options: DashboardRouterOptions) {
    this.authStore = options.authStore;
    this.dashboardStore = options.dashboardStore;
    this.storage = options.storage;
  }

  public async handle(request: BentoRequest): Promise<BentoResponse> {
    if (request.path.startsWith(STATIC_PATH_PREFIX)) {
      return await serveStaticAsset(request.path);
    }

    const context = await this.createContext(request);
    const method = request.method.toUpperCase();

    if (method === METHOD_GET && request.path === ROOT_UI_PATH) {
      return redirectResponse("/ui/buckets");
    }

    if (method === METHOD_GET && request.path === "/ui/login") {
      return await this.renderPage({
        title: "Sign In",
        template: "login",
        context,
        data: { error: "" },
      });
    }

    if (method === METHOD_POST && request.path === "/ui/login") {
      return await this.handleLoginRequest(request);
    }

    if (!context.user) {
      return redirectResponse("/ui/login");
    }

    if (method === METHOD_POST && request.path === "/ui/logout") {
      return await this.handleLogoutRequest(request);
    }

    if (method === METHOD_GET && request.path === "/ui/buckets") {
      return await this.handleBucketsPage(context);
    }

    if (method === METHOD_GET && request.path === "/ui/buckets/new") {
      return await this.renderPage({
        title: "New Bucket",
        template: "new-bucket",
        context,
        activePath: "/ui/buckets",
        data: { error: "" },
      });
    }

    if (method === METHOD_POST && request.path === "/ui/buckets") {
      return await this.handleCreateBucketRequest(request, context);
    }

    if (
      method === METHOD_POST &&
      request.path.startsWith("/ui/credentials/") &&
      request.path.endsWith("/delete")
    ) {
      return await this.handleDeleteCredentialRequest(request);
    }

    if (method === METHOD_POST && request.path.endsWith("/delete")) {
      return await this.handleDeleteRequest(request, context);
    }

    if (method === METHOD_POST && request.path === "/ui/buckets/upload") {
      return await this.handleUploadObjectRequest(request, context);
    }

    if (method === METHOD_GET && request.path.includes(OBJECTS_PATH_MARKER)) {
      return await this.handleDownloadObjectRequest(request);
    }

    if (method === METHOD_GET && request.path.startsWith("/ui/buckets/")) {
      return await this.handleBucketDetailPage(request, context);
    }

    if (method === METHOD_GET && request.path === "/ui/credentials") {
      return await this.handleCredentialsPage(context);
    }

    if (method === METHOD_GET && request.path === "/ui/credentials/new") {
      return await this.renderPage({
        title: "New Credential",
        template: "new-credential",
        context,
        activePath: "/ui/credentials",
      });
    }

    if (method === METHOD_POST && request.path === "/ui/credentials") {
      return await this.handleCreateCredentialRequest(request, context);
    }

    return await this.renderMessagePage({ title: "Not Found", context, statusCode: 404 });
  }

  private async handleLoginRequest(request: BentoRequest): Promise<BentoResponse> {
    const form = await readForm(request);
    const username = form.get("username") ?? "";
    const password = form.get("password") ?? "";
    const user = await this.dashboardStore.authenticateUser(username, password);

    if (!user) {
      return await this.renderPage(
        {
          title: "Sign In",
          template: "login",
          context: {},
          data: { error: "Invalid username or password." },
        },
        401,
      );
    }

    const session = await this.dashboardStore.createSession(user.id);

    return redirectResponse("/ui/buckets", {
      "set-cookie": serializeSessionCookie(session.token, session.expiresAt),
    });
  }

  private async handleLogoutRequest(request: BentoRequest): Promise<BentoResponse> {
    const token = readCookie(request, COOKIE_SESSION);

    if (token) {
      await this.dashboardStore.deleteSession(token);
    }

    return redirectResponse("/ui/login", {
      "set-cookie": `${COOKIE_SESSION}=; Path=/ui; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
  }

  private async handleBucketsPage(context: DashboardContext): Promise<BentoResponse> {
    const buckets = await this.storage.listBuckets();
    const bucketViews = await Promise.all(
      buckets.map(async (bucket) => {
        const objects = (await this.storage.listObjects({ bucket: bucket.name })).objects;
        const storedBytes = objects.reduce((size, object) => size + object.size, 0);

        return {
          name: bucket.name,
          encodedName: encodeURIComponent(bucket.name),
          objectCount: objects.length,
          stored: formatBytes(storedBytes),
          createdAt: formatDateTime(bucket.createdAt),
          storedBytes,
        };
      }),
    );
    const totalObjects = bucketViews.reduce((count, bucket) => count + bucket.objectCount, 0);
    const totalBytes = bucketViews.reduce((size, bucket) => size + bucket.storedBytes, 0);

    return await this.renderPage({
      title: "Buckets",
      template: "buckets",
      context,
      activePath: "/ui/buckets",
      data: {
        buckets: bucketViews,
        stats: {
          bucketCount: buckets.length,
          objectCount: totalObjects,
          stored: formatBytes(totalBytes),
        },
      },
    });
  }

  private async handleCreateBucketRequest(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const form = await readForm(request);
    const bucketName = form.get("bucketName") ?? "";

    try {
      await this.storage.createBucket(bucketName);
      return redirectResponse(`/ui/buckets/${encodeURIComponent(bucketName)}`);
    } catch (error) {
      return await this.renderPage(
        {
          title: "New Bucket",
          template: "new-bucket",
          context,
          activePath: "/ui/buckets",
          data: { error: readErrorMessage(error) },
        },
        400,
      );
    }
  }

  private async handleBucketDetailPage(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const bucket = decodeURIComponent(request.path.slice("/ui/buckets/".length));
    const objects = (await this.storage.listObjects({ bucket })).objects;
    const totalBytes = objects.reduce((size, object) => size + object.size, 0);

    return await this.renderPage({
      title: bucket,
      template: "bucket-detail",
      context,
      activePath: "/ui/buckets",
      data: {
        bucket: {
          name: bucket,
          encodedName: encodeURIComponent(bucket),
          objectCount: objects.length,
          stored: formatBytes(totalBytes),
        },
        objects: objects.map((object) => ({
          key: object.key,
          encodedKey: encodeURIComponent(object.key),
          size: formatBytes(object.size),
          lastModified: formatDateTime(object.lastModified),
        })),
      },
    });
  }

  private async handleUploadObjectRequest(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const form = await readUploadForm(request);

    try {
      await this.storage.putObject({ bucket: form.bucket, key: form.key, body: form.body });
      return redirectResponse(`/ui/buckets/${encodeURIComponent(form.bucket)}`);
    } catch (error) {
      return await this.renderMessagePage({
        title: "Upload Failed",
        context,
        message: readErrorMessage(error),
        statusCode: 400,
      });
    }
  }

  private async handleDeleteRequest(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const objectDelete = parseObjectDeletePath(request.path);

    try {
      if (objectDelete) {
        await this.storage.deleteObject(objectDelete.bucket, objectDelete.key);
        return redirectResponse(`/ui/buckets/${encodeURIComponent(objectDelete.bucket)}`);
      }

      const bucket = decodeURIComponent(
        request.path.slice("/ui/buckets/".length, -"/delete".length),
      );
      await this.storage.deleteBucket(bucket);
      return redirectResponse("/ui/buckets");
    } catch (error) {
      return await this.renderMessagePage({
        title: "Delete Failed",
        context,
        message: readErrorMessage(error),
        statusCode: 409,
      });
    }
  }

  private async handleCredentialsPage(context: DashboardContext): Promise<BentoResponse> {
    const credentials = await this.authStore.listCredentials();
    const enabledCount = credentials.filter((credential) => credential.enabled).length;

    return await this.renderPage({
      title: "Credentials",
      template: "credentials",
      context,
      activePath: "/ui/credentials",
      data: {
        credentials: credentials.map((credential) => ({
          accessKeyId: credential.accessKeyId,
          encodedAccessKeyId: encodeURIComponent(credential.accessKeyId),
          status: credential.enabled ? "Enabled" : "Disabled",
          createdAt: formatDateTime(credential.createdAt),
        })),
        stats: {
          total: credentials.length,
          enabled: enabledCount,
          disabled: credentials.length - enabledCount,
        },
      },
    });
  }

  private async handleCreateCredentialRequest(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const form = await readForm(request);
    const requestedAccessKeyId = form.get("accessKeyId");
    const accessKeyId = requestedAccessKeyId?.length
      ? requestedAccessKeyId
      : `BENTO${randomBytes(8).toString("hex").toUpperCase()}`;
    const secretAccessKey = randomBytes(24).toString("base64url");
    const credential = await this.authStore.createCredential({ accessKeyId, secretAccessKey });

    return await this.renderPage({
      title: "Credential Created",
      template: "credential-created",
      context,
      activePath: "/ui/credentials",
      data: {
        credential: {
          accessKeyId: credential.accessKeyId,
          secretAccessKey: credential.secretAccessKey,
        },
      },
    });
  }

  private async handleDeleteCredentialRequest(request: BentoRequest): Promise<BentoResponse> {
    const accessKeyId = decodeURIComponent(
      request.path.slice("/ui/credentials/".length, -"/delete".length),
    );

    await this.authStore.disableCredential(accessKeyId);

    return redirectResponse("/ui/credentials");
  }

  private async handleDownloadObjectRequest(request: BentoRequest): Promise<BentoResponse> {
    const objectPath = parseObjectPath(request.path);

    if (!objectPath) {
      return await this.renderMessagePage({ title: "Not Found", context: {}, statusCode: 404 });
    }

    const object = await this.storage.getObject(objectPath.bucket, objectPath.key);

    return {
      statusCode: 200,
      headers: {
        "content-disposition": `attachment; filename="${objectPath.key.split("/").at(-1) ?? "object"}"`,
        "content-type": object.info.contentType ?? CONTENT_TYPE_OCTET_STREAM,
      },
      body: object.body,
    };
  }

  private async createContext(request: BentoRequest): Promise<DashboardContext> {
    const token = readCookie(request, COOKIE_SESSION);

    if (!token) {
      return {};
    }

    const user = await this.dashboardStore.getUserBySessionToken(token);

    return user ? { user } : {};
  }

  private async renderPage(input: RenderPageInput, statusCode = 200): Promise<BentoResponse> {
    const body = await renderDashboardPage(input);

    return htmlResponse(body, statusCode);
  }

  private async renderMessagePage(input: {
    title: string;
    context: DashboardContext;
    message?: string;
    statusCode: number;
  }): Promise<BentoResponse> {
    return await this.renderPage(
      {
        title: input.title,
        template: "message",
        context: input.context,
        data: { message: input.message ?? "" },
      },
      input.statusCode,
    );
  }
}

async function serveStaticAsset(path: string): Promise<BentoResponse> {
  if (path === VENDOR_TURBO_STATIC_PATH) {
    return await serveStaticFile(TURBO_PACKAGE_BUNDLE_PATH);
  }

  const assetPath = resolveStaticAssetPath(path);

  if (!assetPath) {
    return textResponse("Not found.", "text/plain; charset=utf-8", 404);
  }

  return await serveStaticFile(assetPath);
}

async function serveStaticFile(path: string): Promise<BentoResponse> {
  try {
    const body = await readFile(path);
    const contentType = STATIC_CONTENT_TYPES[extname(path)] ?? CONTENT_TYPE_OCTET_STREAM;

    return { statusCode: 200, headers: { [HEADER_CONTENT_TYPE]: contentType }, body };
  } catch {
    return textResponse("Not found.", "text/plain; charset=utf-8", 404);
  }
}

function resolveStaticAssetPath(path: string): string | undefined {
  const requestedPath = decodeDashboardPath(path.slice(STATIC_PATH_PREFIX.length));

  if (!requestedPath) {
    return undefined;
  }

  const assetPath = resolve(STATIC_ROOT_DIR, requestedPath);
  const isWithinStaticRoot = assetPath.startsWith(`${STATIC_ROOT_DIR}${sep}`);

  return isWithinStaticRoot ? assetPath : undefined;
}

function decodeDashboardPath(path: string): string | undefined {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
}

async function renderDashboardPage(input: RenderPageInput): Promise<string> {
  const content = await renderTemplate(input.template, input.data ?? {});

  return await renderTemplate("layout", {
    activePath: input.activePath ?? "",
    content,
    title: input.title,
    user: input.context.user,
  });
}

async function renderTemplate(templateName: string, data: TemplateData): Promise<string> {
  const templatePath = resolve(TEMPLATE_ROOT_DIR, `${templateName}${TEMPLATE_EXTENSION}`);

  return await ejs.renderFile(templatePath, data, { cache: true, filename: templatePath });
}

async function readForm(request: BentoRequest): Promise<URLSearchParams> {
  const chunks: Uint8Array[] = [];

  if (!request.body) {
    return new URLSearchParams();
  }

  for await (const chunk of request.body) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
    );
  }

  return new URLSearchParams(new TextDecoder().decode(Buffer.concat(chunks)));
}

async function readUploadForm(request: BentoRequest): Promise<UploadFormData> {
  const contentType = getHeader(request, HEADER_CONTENT_TYPE);
  const body = await readRequestBody(request);

  if (!contentType?.includes("multipart/form-data")) {
    const form = new URLSearchParams(new TextDecoder().decode(body));
    const bucket = form.get("bucket") ?? "";
    const key = form.get("key") ?? "";
    const textBody = form.get("body") ?? "";

    return { bucket, key, body: new TextEncoder().encode(textBody) };
  }

  const boundary = readMultipartBoundary(contentType);

  if (!boundary) {
    return { bucket: "", key: "", body: new Uint8Array() };
  }

  const parts = parseMultipartBody(body, boundary);
  const bucket = readMultipartText(parts, "bucket");
  const requestedKey = readMultipartText(parts, "key");
  const textBody = readMultipartText(parts, "body");
  const file = parts.find(
    (part) => part.name === "file" && part.filename && part.body.byteLength > 0,
  );
  const key = requestedKey.length > 0 ? requestedKey : (file?.filename ?? "");

  if (file) {
    return { bucket, key, body: file.body };
  }

  return { bucket, key, body: new TextEncoder().encode(textBody) };
}

async function readRequestBody(request: BentoRequest): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  if (!request.body) {
    return new Uint8Array();
  }

  for await (const chunk of request.body) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk),
    );
  }

  return Buffer.concat(chunks);
}

function readMultipartBoundary(contentType: string): string | undefined {
  return contentType
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(MULTIPART_BOUNDARY_PREFIX))
    ?.slice(MULTIPART_BOUNDARY_PREFIX.length);
}

function parseMultipartBody(body: Uint8Array, boundary: string): MultipartPart[] {
  const rawBody = Buffer.from(body).toString("binary");
  const delimiter = `--${boundary}`;

  return rawBody
    .split(delimiter)
    .map((part) => part.trimStart())
    .filter((part) => part && part !== "--")
    .map(parseMultipartPart)
    .filter((part): part is MultipartPart => part !== undefined);
}

function parseMultipartPart(rawPart: string): MultipartPart | undefined {
  const trimmedPart = rawPart.endsWith("--\r\n") ? rawPart.slice(0, -4) : rawPart;
  const [rawHeaders, rawBody] = splitOnce(trimmedPart, "\r\n\r\n");

  if (!rawHeaders || rawBody === undefined) {
    return undefined;
  }

  const disposition = rawHeaders
    .split("\r\n")
    .find((header) => header.toLowerCase().startsWith("content-disposition:"));
  const name = readDispositionValue(disposition, "name");

  if (!name) {
    return undefined;
  }

  const filename = readDispositionValue(disposition, "filename");
  const body = Buffer.from(removeTrailingMultipartNewline(rawBody), "binary");

  return { name, ...(filename ? { filename } : {}), body };
}

function readMultipartText(parts: MultipartPart[], name: string): string {
  const part = parts.find((candidate) => candidate.name === name);

  return part ? new TextDecoder().decode(part.body) : "";
}

function readDispositionValue(disposition: string | undefined, name: string): string | undefined {
  return disposition
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .replace(/^"|"$/g, "");
}

function removeTrailingMultipartNewline(value: string): string {
  return value.endsWith("\r\n") ? value.slice(0, -2) : value;
}

function splitOnce(value: string, separator: string): [string | undefined, string | undefined] {
  const separatorIndex = value.indexOf(separator);

  if (separatorIndex === -1) {
    return [value, undefined];
  }

  return [value.slice(0, separatorIndex), value.slice(separatorIndex + separator.length)];
}

function parseObjectDeletePath(path: string): { bucket: string; key: string } | undefined {
  const markerIndex = path.indexOf(OBJECTS_PATH_MARKER);

  if (markerIndex === -1 || !path.endsWith("/delete")) {
    return undefined;
  }

  return {
    bucket: decodeURIComponent(path.slice("/ui/buckets/".length, markerIndex)),
    key: decodeURIComponent(
      path.slice(markerIndex + OBJECTS_PATH_MARKER.length, -"/delete".length),
    ),
  };
}

function parseObjectPath(path: string): { bucket: string; key: string } | undefined {
  const markerIndex = path.indexOf(OBJECTS_PATH_MARKER);

  if (markerIndex === -1) {
    return undefined;
  }

  return {
    bucket: decodeURIComponent(path.slice("/ui/buckets/".length, markerIndex)),
    key: decodeURIComponent(path.slice(markerIndex + OBJECTS_PATH_MARKER.length)),
  };
}

function readCookie(request: BentoRequest, name: string): string | undefined {
  const cookieHeader = request.headers[HEADER_COOKIE];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;

  return cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function getHeader(request: BentoRequest, name: string): string | undefined {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function serializeSessionCookie(token: string, expiresAt: Date): string {
  return `${COOKIE_SESSION}=${token}; Path=/ui; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}`;
}

function htmlResponse(body: string, statusCode = 200): BentoResponse {
  return { statusCode, headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_HTML }, body };
}

function textResponse(body: string, contentType: string, statusCode = 200): BentoResponse {
  return { statusCode, headers: { [HEADER_CONTENT_TYPE]: contentType }, body };
}

function redirectResponse(location: string, headers: Record<string, string> = {}): BentoResponse {
  return { statusCode: 303, headers: { [HEADER_LOCATION]: location, ...headers }, body: "" };
}

function readErrorMessage(error: unknown): string {
  if (error instanceof StorageError || error instanceof Error) {
    return error.message;
  }

  return "Request failed.";
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${String(size)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex] ?? "KB"}`;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
