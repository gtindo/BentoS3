import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ejs from "ejs";
import type { AuthStore } from "../auth/types.js";
import {
  DEFAULT_MAX_REQUEST_BODY_BYTES,
  readRequestBody,
  RequestBodyTooLargeError,
} from "../core/body.js";
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
const PAGINATION_PAGE_SIZE = 50;
const PAGE_QUERY_PARAMETER = "page";
const ROOT_UI_PATH = "/ui";
const STATIC_PATH_PREFIX = "/ui/static/";
const TEMPLATE_EXTENSION = ".ejs";
const UPLOAD_VALIDATION_STATUS_CODE = 422;
const VENDOR_TURBO_STATIC_PATH = "/ui/static/vendor/turbo.es2017-esm.js";
const EMPTY_UPLOAD_MESSAGE = "Choose a file or enter both an object key and object body.";
const MISSING_TEXT_KEY_MESSAGE = "Enter an object key for the text upload.";
const MISSING_TEXT_BODY_MESSAGE = "Enter an object body for the text upload.";
const UNSAFE_OBJECT_KEY_MESSAGE = "Object key is not safe to store on disk.";
const INTERNAL_BUCKET_METADATA_FILE = ".bentos3-bucket.json";
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
  maxRequestBodyBytes?: number;
  storage: StorageDriver;
}

interface DashboardContext {
  user?: DashboardUser;
}

interface UploadFormData {
  bucket: string;
  key: string;
  body: Uint8Array;
  hasFile: boolean;
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

interface PaginationView {
  currentPage: number;
  endItem: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextHref: string;
  pagePath: string;
  pageSize: number;
  previousHref: string;
  startItem: number;
  totalItems: number;
  totalPages: number;
}

interface PaginatedItems<T> {
  items: T[];
  pagination: PaginationView;
}

interface DashboardRouteDefinition {
  method: string;
  requiresAuth: boolean;
  matches(path: string): boolean;
  handle(request: BentoRequest, context: DashboardContext): Promise<BentoResponse>;
}

export class DashboardRouter implements BentoHandler {
  private readonly authStore: AuthStore;
  private readonly dashboardStore: JsonDashboardStore;
  private readonly maxRequestBodyBytes: number;
  private readonly storage: StorageDriver;
  private readonly routes: DashboardRouteDefinition[] = [
    {
      method: METHOD_GET,
      requiresAuth: false,
      matches: (path) => matchesExactPath(path, ROOT_UI_PATH),
      handle: () => Promise.resolve(redirectResponse("/ui/buckets")),
    },
    {
      method: METHOD_GET,
      requiresAuth: false,
      matches: (path) => matchesExactPath(path, "/ui/login"),
      handle: async (_request, context) =>
        this.renderPage({
          title: "Sign In",
          template: "login",
          context,
          data: { error: "" },
        }),
    },
    {
      method: METHOD_POST,
      requiresAuth: false,
      matches: (path) => matchesExactPath(path, "/ui/login"),
      handle: async (request) => this.handleLoginRequest(request),
    },
    {
      method: METHOD_POST,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/logout"),
      handle: async (request) => this.handleLogoutRequest(request),
    },
    {
      method: METHOD_GET,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/buckets"),
      handle: async (request, context) => this.handleBucketsPage(request, context),
    },
    {
      method: METHOD_GET,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/buckets/new"),
      handle: async (_request, context) =>
        this.renderPage({
          title: "New Bucket",
          template: "new-bucket",
          context,
          activePath: "/ui/buckets",
          data: { error: "" },
        }),
    },
    {
      method: METHOD_POST,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/buckets"),
      handle: async (request, context) => this.handleCreateBucketRequest(request, context),
    },
    {
      method: METHOD_POST,
      requiresAuth: true,
      matches: (path) =>
        matchesPathPrefix(path, "/ui/credentials") && matchesPathSuffix(path, "/delete"),
      handle: async (request) => this.handleDeleteCredentialRequest(request),
    },
    {
      method: METHOD_POST,
      requiresAuth: true,
      matches: (path) => matchesPathSuffix(path, "/delete"),
      handle: async (request, context) => this.handleDeleteRequest(request, context),
    },
    {
      method: METHOD_POST,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/buckets/upload"),
      handle: async (request, context) => this.handleUploadObjectRequest(request, context),
    },
    {
      method: METHOD_GET,
      requiresAuth: true,
      matches: (path) => path.includes(OBJECTS_PATH_MARKER),
      handle: async (request) => this.handleDownloadObjectRequest(request),
    },
    {
      method: METHOD_GET,
      requiresAuth: true,
      matches: (path) => matchesBucketUploadPath(path),
      handle: async (request, context) => this.handleUploadObjectPage(request, context),
    },
    {
      method: METHOD_GET,
      requiresAuth: true,
      matches: (path) => matchesPathPrefix(path, "/ui/buckets"),
      handle: async (request, context) => this.handleBucketDetailPage(request, context),
    },
    {
      method: METHOD_GET,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/credentials"),
      handle: async (_request, context) => this.handleCredentialsPage(context),
    },
    {
      method: METHOD_GET,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/credentials/new"),
      handle: async (_request, context) =>
        this.renderPage({
          title: "New Credential",
          template: "new-credential",
          context,
          activePath: "/ui/credentials",
        }),
    },
    {
      method: METHOD_POST,
      requiresAuth: true,
      matches: (path) => matchesExactPath(path, "/ui/credentials"),
      handle: async (request, context) => this.handleCreateCredentialRequest(request, context),
    },
  ];

  public constructor(options: DashboardRouterOptions) {
    this.authStore = options.authStore;
    this.dashboardStore = options.dashboardStore;
    this.maxRequestBodyBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
    this.storage = options.storage;
  }

  public async handle(request: BentoRequest): Promise<BentoResponse> {
    if (request.path.startsWith(STATIC_PATH_PREFIX)) {
      return await serveStaticAsset(request.path);
    }

    const context = await this.createContext(request);
    const method = request.method.toUpperCase();
    const route = findDashboardRoute(this.routes, method, request.path);

    if (!route) {
      return await this.renderMessagePage({ title: "Not Found", context, statusCode: 404 });
    }

    if (route.requiresAuth && !context.user) {
      return redirectResponse("/ui/login");
    }

    try {
      return await route.handle(request, context);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return await this.renderMessagePage({
          title: "Request Too Large",
          context,
          message: error.message,
          statusCode: 413,
        });
      }

      throw error;
    }
  }

  private async handleLoginRequest(request: BentoRequest): Promise<BentoResponse> {
    const form = await readForm(request, this.maxRequestBodyBytes);
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

  private async handleBucketsPage(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const buckets = await this.storage.listBuckets();
    const paginatedBuckets = paginateItems(buckets, request.query, "/ui/buckets");
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
    const paginatedBucketViews = paginatedBuckets.items.map((bucket) => {
      const bucketView = bucketViews.find((candidate) => candidate.name === bucket.name);

      if (!bucketView) {
        throw new Error(`Unable to render bucket ${bucket.name}.`);
      }

      return bucketView;
    });
    const totalObjects = bucketViews.reduce((count, bucket) => count + bucket.objectCount, 0);
    const totalBytes = bucketViews.reduce((size, bucket) => size + bucket.storedBytes, 0);

    return await this.renderPage({
      title: "Buckets",
      template: "buckets",
      context,
      activePath: "/ui/buckets",
      data: {
        buckets: paginatedBucketViews,
        pagination: paginatedBuckets.pagination,
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
    const form = await readForm(request, this.maxRequestBodyBytes);
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
    const pagePath = `/ui/buckets/${encodeURIComponent(bucket)}`;
    const paginatedObjects = paginateItems(objects, request.query, pagePath);
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
        objects: paginatedObjects.items.map((object) => ({
          key: object.key,
          encodedKey: encodeURIComponent(object.key),
          size: formatBytes(object.size),
          lastModified: formatDateTime(object.lastModified),
        })),
        pagination: paginatedObjects.pagination,
      },
    });
  }

  private async handleUploadObjectPage(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const bucket = decodeURIComponent(request.path.slice("/ui/buckets/".length, -"/upload".length));

    return await this.renderUploadObjectPage(context, bucket);
  }

  private async renderUploadObjectPage(
    context: DashboardContext,
    bucket: string,
    error = "",
    statusCode = 200,
  ): Promise<BentoResponse> {
    return await this.renderPage(
      {
        title: "Upload Object",
        template: "upload-object",
        context,
        activePath: "/ui/buckets",
        data: {
          bucket: {
            name: bucket,
            encodedName: encodeURIComponent(bucket),
          },
          error,
        },
      },
      statusCode,
    );
  }

  private async handleUploadObjectRequest(
    request: BentoRequest,
    context: DashboardContext,
  ): Promise<BentoResponse> {
    const form = await readUploadForm(request, this.maxRequestBodyBytes);
    const validationError = validateUploadForm(form);

    if (validationError) {
      return await this.renderUploadObjectPage(
        context,
        form.bucket,
        validationError,
        UPLOAD_VALIDATION_STATUS_CODE,
      );
    }

    try {
      await this.storage.putObject({ bucket: form.bucket, key: form.key, body: form.body });
      return redirectResponse(`/ui/buckets/${encodeURIComponent(form.bucket)}`);
    } catch (error) {
      if (error instanceof StorageError && error.code === "InvalidObjectKey") {
        return await this.renderUploadObjectPage(
          context,
          form.bucket,
          readErrorMessage(error),
          UPLOAD_VALIDATION_STATUS_CODE,
        );
      }

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
    const form = await readForm(request, this.maxRequestBodyBytes);
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

function findDashboardRoute(
  routes: DashboardRouteDefinition[],
  method: string,
  path: string,
): DashboardRouteDefinition | undefined {
  return routes.find((route) => route.method === method && route.matches(path));
}

function matchesExactPath(path: string, routePath: string): boolean {
  return path === routePath;
}

function matchesPathPrefix(path: string, pathPrefix: string): boolean {
  return path === pathPrefix || path.startsWith(`${pathPrefix}/`);
}

function matchesPathSuffix(path: string, pathSuffix: string): boolean {
  return path.endsWith(pathSuffix);
}

function matchesBucketUploadPath(path: string): boolean {
  return matchesPathPrefix(path, "/ui/buckets") && matchesPathSuffix(path, "/upload");
}

export function paginateItems<T>(
  items: T[],
  query: URLSearchParams,
  pagePath: string,
): PaginatedItems<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGINATION_PAGE_SIZE));
  const requestedPage = parsePaginationPage(query);
  const currentPage = Math.min(requestedPage, totalPages);
  const startIndex = (currentPage - 1) * PAGINATION_PAGE_SIZE;
  const endIndex = startIndex + PAGINATION_PAGE_SIZE;
  const hasPreviousPage = currentPage > 1;
  const hasNextPage = currentPage < totalPages;
  const startItem = totalItems === 0 ? 0 : startIndex + 1;
  const endItem = Math.min(endIndex, totalItems);

  return {
    items: items.slice(startIndex, endIndex),
    pagination: {
      currentPage,
      endItem,
      hasNextPage,
      hasPreviousPage,
      nextHref: hasNextPage ? createPaginationHref(pagePath, currentPage + 1) : "",
      pagePath,
      pageSize: PAGINATION_PAGE_SIZE,
      previousHref: hasPreviousPage ? createPaginationHref(pagePath, currentPage - 1) : "",
      startItem,
      totalItems,
      totalPages,
    },
  };
}

export function parsePaginationPage(query: URLSearchParams): number {
  const rawPage = query.get(PAGE_QUERY_PARAMETER);

  if (!rawPage) {
    return 1;
  }

  const page = Number.parseInt(rawPage, 10);

  if (!Number.isSafeInteger(page) || page < 1) {
    return 1;
  }

  return page;
}

export function createPaginationHref(pagePath: string, page: number): string {
  if (page <= 1) {
    return pagePath;
  }

  return `${pagePath}?${PAGE_QUERY_PARAMETER}=${String(page)}`;
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

  return await ejs.renderFile(templatePath, data, { cache: false, filename: templatePath });
}

async function readForm(request: BentoRequest, maxBodyBytes: number): Promise<URLSearchParams> {
  const body = await readRequestBody(request.body, maxBodyBytes);

  return new URLSearchParams(new TextDecoder().decode(body));
}

async function readUploadForm(
  request: BentoRequest,
  maxBodyBytes: number,
): Promise<UploadFormData> {
  const contentType = getHeader(request, HEADER_CONTENT_TYPE);
  const body = await readRequestBody(request.body, maxBodyBytes);

  if (!contentType?.includes("multipart/form-data")) {
    const form = new URLSearchParams(new TextDecoder().decode(body));
    const bucket = form.get("bucket") ?? "";
    const key = form.get("key") ?? "";
    const textBody = form.get("body") ?? "";

    return { bucket, key, body: new TextEncoder().encode(textBody), hasFile: false };
  }

  const boundary = readMultipartBoundary(contentType);

  if (!boundary) {
    return { bucket: "", key: "", body: new Uint8Array(), hasFile: false };
  }

  const parts = parseMultipartBody(body, boundary);
  const bucket = readMultipartText(parts, "bucket");
  const requestedKey = readMultipartText(parts, "key");
  const textBody = readMultipartText(parts, "body");
  const file = parts.find((part) => part.name === "file" && part.filename);
  const key = requestedKey.length > 0 ? requestedKey : (file?.filename ?? "");

  if (file) {
    return { bucket, key, body: file.body, hasFile: true };
  }

  return { bucket, key, body: new TextEncoder().encode(textBody), hasFile: false };
}

function validateUploadForm(form: UploadFormData): string | undefined {
  const hasKey = form.key.length > 0;
  const hasBody = form.body.byteLength > 0;

  if (!form.hasFile) {
    if (!hasKey && !hasBody) {
      return EMPTY_UPLOAD_MESSAGE;
    }

    if (!hasKey) {
      return MISSING_TEXT_KEY_MESSAGE;
    }

    if (!hasBody) {
      return MISSING_TEXT_BODY_MESSAGE;
    }
  }

  if (isUnsafeObjectKey(form.key)) {
    return UNSAFE_OBJECT_KEY_MESSAGE;
  }

  return undefined;
}

function isUnsafeObjectKey(key: string): boolean {
  const normalizedKey = normalize(key);
  const segments = normalizedKey.split(sep);
  const targetsBucketMetadata = normalizedKey === INTERNAL_BUCKET_METADATA_FILE;

  return key.length === 0 || isAbsolute(key) || segments.includes("..") || targetsBucketMetadata;
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
