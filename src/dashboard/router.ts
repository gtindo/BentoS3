import { randomBytes } from "node:crypto";
import type { AuthStore } from "../auth/types.js";
import type { BentoHandler, BentoRequest, BentoResponse } from "../core/types.js";
import { StorageError } from "../storage/errors.js";
import type { StorageDriver } from "../storage/types.js";
import { JsonDashboardStore, type DashboardUser } from "./json-dashboard-store.js";

const CONTENT_TYPE_CSS = "text/css; charset=utf-8";
const CONTENT_TYPE_HTML = "text/html; charset=utf-8";
const CONTENT_TYPE_JAVASCRIPT = "text/javascript; charset=utf-8";
const COOKIE_SESSION = "bentos3_session";
const HEADER_CONTENT_TYPE = "content-type";
const HEADER_COOKIE = "cookie";
const HEADER_LOCATION = "location";
const MULTIPART_BOUNDARY_PREFIX = "boundary=";
const METHOD_GET = "GET";
const METHOD_POST = "POST";
const ROOT_UI_PATH = "/ui";
const STATIC_CSS_PATH = "/ui/static/app.css";
const STATIC_TURBO_PATH = "/ui/static/turbo.js";

const APP_CSS = `
:root{color-scheme:light;--bg:#f7f8fa;--panel:#fff;--panel-soft:#f3f4f6;--text:#111827;--muted:#6b7280;--line:#d1d5db;--line-strong:#9ca3af;--primary:#111827;--primary-dark:#000;--danger:#b91c1c;--danger-soft:#fef2f2}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}.auth-shell{min-height:100vh;display:grid;place-items:center;padding:28px}.auth-panel{width:100%;max-width:420px;transform:translateY(-4vh)}.auth-header{margin-bottom:22px;text-align:center}.auth-header h1{margin:0;font-size:30px;letter-spacing:-.04em}.auth-header p{margin:10px 0 0;color:var(--muted)}.topbar{position:sticky;top:0;z-index:10;background:#fff;border-bottom:1px solid var(--line)}.topbar-inner{max-width:1180px;margin:0 auto;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;gap:22px}.brand{font-weight:800;letter-spacing:-.03em}.topnav{display:flex;align-items:center;gap:4px}.topnav a{padding:9px 12px;color:var(--muted);font-weight:650;font-size:14px;border:1px solid transparent}.topnav a.active,.topnav a:hover{background:var(--panel-soft);border-color:var(--line);color:var(--text)}.userbar{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:14px}.shell{max-width:1180px;margin:0 auto;padding:34px 28px 52px}.page{display:grid;gap:22px}.breadcrumb{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:14px}.breadcrumb a{color:#374151}.breadcrumb span:last-child{color:var(--text);font-weight:650}.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.eyebrow{margin:0 0 8px;color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.hero h1{margin:0;font-size:34px;line-height:1.08;letter-spacing:-.04em}.hero p{margin:10px 0 0;color:var(--muted);max-width:680px}.grid{display:grid;gap:18px}.stats{grid-template-columns:repeat(3,minmax(0,1fr))}.stat-card{background:#fff;border:1px solid var(--line);padding:18px}.stat-label{color:var(--muted);font-size:13px;font-weight:650}.stat-value{display:block;margin-top:7px;font-size:28px;letter-spacing:-.04em;font-weight:800}.card{background:var(--panel);border:1px solid var(--line);overflow:hidden}.card-body{padding:22px}.panel-title{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 22px;border-bottom:1px solid var(--line);background:#fff}.panel-title h2{margin:0;font-size:18px;letter-spacing:-.02em}.stack{display:grid;gap:16px}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.table{width:100%;border-collapse:collapse}.table th{padding:12px 22px;color:var(--muted);background:var(--panel-soft);font-size:12px;text-transform:uppercase;letter-spacing:.05em;text-align:left}.table td{padding:16px 22px;border-top:1px solid var(--line);vertical-align:middle}.name-cell{display:flex;align-items:center;gap:12px;font-weight:750}.resource-icon{width:38px;height:38px;background:var(--panel-soft);border:1px solid var(--line);color:var(--text);display:grid;place-items:center;font-weight:900}.input,.textarea{border:1px solid var(--line-strong);padding:11px 12px;min-width:260px;width:100%;font:inherit;background:white}.input[type=file]{padding:9px}.textarea{min-height:118px;resize:vertical}.field{display:grid;gap:7px}.field label{font-weight:700;font-size:14px}.help,.muted{color:var(--muted)}.button{border:1px solid var(--primary);background:var(--primary);color:white;padding:10px 14px;cursor:pointer;font-weight:750;display:inline-flex;align-items:center;justify-content:center;gap:8px}.button:hover{background:var(--primary-dark)}.button.secondary{background:#fff;color:#374151;border:1px solid var(--line-strong)}.button.ghost{background:transparent;color:#374151;border-color:transparent}.button.danger{background:var(--danger);border-color:var(--danger)}.inline-form{display:inline}.flash{background:var(--danger-soft);border:1px solid #fecaca;color:#991b1b;padding:12px 14px}.secret{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--panel-soft);border:1px solid var(--line);padding:8px;display:inline-block}.empty{padding:38px;text-align:center;color:var(--muted)}.empty h3{margin:0 0 8px;color:var(--text)}.upload-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,420px);gap:20px}.bucket-summary{background:transparent;border:1px solid var(--line);padding:22px}.bucket-summary h2{margin:0 0 12px;font-size:22px}.summary-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}.summary-item{border-top:1px solid var(--line);padding-top:12px}.divider{border:0;border-top:1px solid var(--line);margin:4px 0}.or-label{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}@media (max-width:800px){.topbar-inner,.hero,.userbar{align-items:flex-start;flex-direction:column}.stats,.upload-grid,.summary-list{grid-template-columns:1fr}.shell{padding:24px 16px}.table{display:block;overflow-x:auto}.hero h1{font-size:28px}.topnav{width:100%;overflow-x:auto}.auth-panel{transform:none}}
`;
const TURBO_JS = `window.Turbo=window.Turbo||{};`;

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
    if (request.path === STATIC_CSS_PATH) {
      return textResponse(APP_CSS, CONTENT_TYPE_CSS);
    }

    if (request.path === STATIC_TURBO_PATH) {
      return textResponse(TURBO_JS, CONTENT_TYPE_JAVASCRIPT);
    }

    const context = await this.createContext(request);
    const method = request.method.toUpperCase();

    if (method === METHOD_GET && request.path === ROOT_UI_PATH) {
      return redirectResponse("/ui/buckets");
    }

    if (method === METHOD_GET && request.path === "/ui/login") {
      return htmlResponse(renderPage({ title: "Sign In", body: renderLoginPage(), context }));
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
      return htmlResponse(renderPage({ title: "New Bucket", body: renderNewBucketPage(), context, activePath: "/ui/buckets" }));
    }

    if (method === METHOD_POST && request.path === "/ui/buckets") {
      return await this.handleCreateBucketRequest(request, context);
    }

    if (method === METHOD_POST && request.path.startsWith("/ui/credentials/") && request.path.endsWith("/delete")) {
      return await this.handleDeleteCredentialRequest(request);
    }

    if (method === METHOD_POST && request.path.endsWith("/delete")) {
      return await this.handleDeleteRequest(request, context);
    }

    if (method === METHOD_POST && request.path === "/ui/buckets/upload") {
      return await this.handleUploadObjectRequest(request, context);
    }

    if (method === METHOD_GET && request.path.includes("/objects/")) {
      return await this.handleDownloadObjectRequest(request);
    }

    if (method === METHOD_GET && request.path.startsWith("/ui/buckets/")) {
      return await this.handleBucketDetailPage(request, context);
    }

    if (method === METHOD_GET && request.path === "/ui/credentials") {
      return await this.handleCredentialsPage(context);
    }

    if (method === METHOD_GET && request.path === "/ui/credentials/new") {
      return htmlResponse(
        renderPage({
          title: "New Credential",
          body: renderNewCredentialPage(),
          context,
          activePath: "/ui/credentials",
        }),
      );
    }

    if (method === METHOD_POST && request.path === "/ui/credentials") {
      return await this.handleCreateCredentialRequest(request, context);
    }

    return htmlResponse(renderPage({ title: "Not Found", body: `<p>Not found.</p>`, context }), 404);
  }

  private async handleLoginRequest(request: BentoRequest): Promise<BentoResponse> {
    const form = await readForm(request);
    const username = form.get("username") ?? "";
    const password = form.get("password") ?? "";
    const user = await this.dashboardStore.authenticateUser(username, password);

    if (!user) {
      return htmlResponse(
        renderPage({ title: "Sign In", body: renderLoginPage("Invalid username or password."), context: {} }),
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
        return { bucket, objects };
      }),
    );
    const totalObjects = bucketViews.reduce((count, view) => count + view.objects.length, 0);
    const totalBytes = bucketViews.reduce(
      (size, view) => size + view.objects.reduce((bucketSize, object) => bucketSize + object.size, 0),
      0,
    );
    const rows = bucketViews
      .map((view) => {
        return `<tr><td><a class="name-cell" href="/ui/buckets/${encodeURIComponent(view.bucket.name)}"><span class="resource-icon">B</span><span>${escapeHtml(view.bucket.name)}</span></a></td><td>${String(view.objects.length)}</td><td>${formatBytes(view.objects.reduce((size, object) => size + object.size, 0))}</td><td>${formatDateTime(view.bucket.createdAt)}</td><td><form class="inline-form" method="post" action="/ui/buckets/${encodeURIComponent(view.bucket.name)}/delete"><button class="button danger">Delete</button></form></td></tr>`;
      })
      .join("");
    const body = `${renderBreadcrumbs([{ label: "Buckets" }])}${renderPageHeader("Buckets", "Manage local S3 buckets and inspect their stored objects.", "Storage", `<a class="button" href="/ui/buckets/new">New bucket</a>`)}<section class="grid stats">${renderStatCard("Buckets", String(buckets.length))}${renderStatCard("Objects", String(totalObjects))}${renderStatCard("Stored", formatBytes(totalBytes))}</section><section class="card"><div class="panel-title"><h2>Bucket inventory</h2><span class="muted">${String(buckets.length)} buckets</span></div>${buckets.length === 0 ? renderEmptyState("No buckets yet", "Create a bucket to start storing objects.", `<a class="button" href="/ui/buckets/new">Create bucket</a>`) : `<table class="table"><thead><tr><th>Name</th><th>Objects</th><th>Stored</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}</section>`;

    return htmlResponse(renderPage({ title: "Buckets", body, context, activePath: "/ui/buckets" }));
  }

  private async handleCreateBucketRequest(request: BentoRequest, context: DashboardContext): Promise<BentoResponse> {
    const form = await readForm(request);
    const bucketName = form.get("bucketName") ?? "";

    try {
      await this.storage.createBucket(bucketName);
      return redirectResponse(`/ui/buckets/${encodeURIComponent(bucketName)}`);
    } catch (error) {
      return htmlResponse(
        renderPage({ title: "New Bucket", body: renderNewBucketPage(readErrorMessage(error)), context }),
        400,
      );
    }
  }

  private async handleBucketDetailPage(request: BentoRequest, context: DashboardContext): Promise<BentoResponse> {
    const bucket = decodeURIComponent(request.path.slice("/ui/buckets/".length));
    const objects = (await this.storage.listObjects({ bucket })).objects;
    const totalBytes = objects.reduce((size, object) => size + object.size, 0);
    const rows = objects
      .map((object) => `<tr><td><a class="name-cell" href="/ui/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(object.key)}"><span class="resource-icon file-icon">F</span><span>${escapeHtml(object.key)}</span></a></td><td>${formatBytes(object.size)}</td><td>${formatDateTime(object.lastModified)}</td><td><form class="inline-form" method="post" action="/ui/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(object.key)}/delete"><button class="button danger">Delete</button></form></td></tr>`)
      .join("");
    const body = `${renderBreadcrumbs([{ label: "Buckets", href: "/ui/buckets" }, { label: bucket }])}${renderPageHeader(bucket, "Browse, upload, download, and remove objects in this bucket.", "Bucket", `<a class="button secondary" href="/ui/buckets">All buckets</a>`)}<section class="upload-grid"><div class="bucket-summary"><p class="eyebrow">Bucket snapshot</p><h2>${escapeHtml(bucket)}</h2><p class="muted">A flat view of the selected bucket and its local object inventory.</p><div class="summary-list"><div class="summary-item"><span class="stat-label">Objects</span><span class="stat-value">${String(objects.length)}</span></div><div class="summary-item"><span class="stat-label">Stored</span><span class="stat-value">${formatBytes(totalBytes)}</span></div></div></div><div class="card"><div class="panel-title"><h2>Upload object</h2></div><div class="card-body">${renderUploadForm(bucket)}</div></div></section><section class="card"><div class="panel-title"><h2>Objects</h2><span class="muted">${String(objects.length)} objects</span></div>${objects.length === 0 ? renderEmptyState("No objects yet", "Upload a file-like object to populate this bucket.", "") : `<table class="table"><thead><tr><th>Key</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>${rows}</tbody></table>`}</section>`;

    return htmlResponse(renderPage({ title: bucket, body, context, activePath: "/ui/buckets" }));
  }

  private async handleUploadObjectRequest(request: BentoRequest, context: DashboardContext): Promise<BentoResponse> {
    const form = await readUploadForm(request);

    try {
      await this.storage.putObject({ bucket: form.bucket, key: form.key, body: form.body });
      return redirectResponse(`/ui/buckets/${encodeURIComponent(form.bucket)}`);
    } catch (error) {
      return htmlResponse(
        renderPage({ title: "Upload Failed", body: `<p class="flash">${escapeHtml(readErrorMessage(error))}</p>`, context }),
        400,
      );
    }
  }

  private async handleDeleteRequest(request: BentoRequest, context: DashboardContext): Promise<BentoResponse> {
    const objectDelete = parseObjectDeletePath(request.path);

    try {
      if (objectDelete) {
        await this.storage.deleteObject(objectDelete.bucket, objectDelete.key);
        return redirectResponse(`/ui/buckets/${encodeURIComponent(objectDelete.bucket)}`);
      }

      const bucket = decodeURIComponent(request.path.slice("/ui/buckets/".length, -"/delete".length));
      await this.storage.deleteBucket(bucket);
      return redirectResponse("/ui/buckets");
    } catch (error) {
      return htmlResponse(
        renderPage({ title: "Delete Failed", body: `<p class="flash">${escapeHtml(readErrorMessage(error))}</p>`, context }),
        409,
      );
    }
  }

  private async handleCredentialsPage(context: DashboardContext): Promise<BentoResponse> {
    const credentials = await this.authStore.listCredentials();
    const rows = credentials.map((credential) => `<tr><td><span class="name-cell"><span class="resource-icon">K</span><span>${escapeHtml(credential.accessKeyId)}</span></span></td><td>${credential.enabled ? "Enabled" : "Disabled"}</td><td>${formatDateTime(credential.createdAt)}</td><td><form class="inline-form" method="post" action="/ui/credentials/${encodeURIComponent(credential.accessKeyId)}/delete"><button class="button danger">Revoke</button></form></td></tr>`).join("");
    const body = `${renderBreadcrumbs([{ label: "Credentials" }])}${renderPageHeader("Credentials", "Create and revoke S3 access keys for local API clients.", "Access", `<a class="button" href="/ui/credentials/new">New credential</a>`)}<section class="grid stats">${renderStatCard("Total keys", String(credentials.length))}${renderStatCard("Enabled", String(credentials.filter((credential) => credential.enabled).length))}${renderStatCard("Disabled", String(credentials.filter((credential) => !credential.enabled).length))}</section><section class="card"><div class="panel-title"><h2>Access keys</h2><span class="muted">${String(credentials.length)} credentials</span></div><table class="table"><thead><tr><th>Access key</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table></section>`;

    return htmlResponse(renderPage({ title: "Credentials", body, context, activePath: "/ui/credentials" }));
  }

  private async handleCreateCredentialRequest(request: BentoRequest, context: DashboardContext): Promise<BentoResponse> {
    const form = await readForm(request);
    const requestedAccessKeyId = form.get("accessKeyId");
    const accessKeyId = requestedAccessKeyId?.length
      ? requestedAccessKeyId
      : `BENTO${randomBytes(8).toString("hex").toUpperCase()}`;
    const secretAccessKey = randomBytes(24).toString("base64url");
    const credential = await this.authStore.createCredential({ accessKeyId, secretAccessKey });
    const body = `${renderBreadcrumbs([{ label: "Credentials", href: "/ui/credentials" }, { label: "Created" }])}${renderPageHeader("Credential created", "Copy this secret now. It will not be shown again.", "Access", `<a class="button secondary" href="/ui/credentials">Back to credentials</a>`)}<div class="card"><div class="card-body stack"><p><strong>Access key:</strong> <span class="secret">${escapeHtml(credential.accessKeyId)}</span></p><p><strong>Secret:</strong> <span class="secret">${escapeHtml(credential.secretAccessKey)}</span></p></div></div>`;

    return htmlResponse(renderPage({ title: "Credential Created", body, context, activePath: "/ui/credentials" }));
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
      return htmlResponse(renderPage({ title: "Not Found", body: `<p>Not found.</p>`, context: {} }), 404);
    }

    const object = await this.storage.getObject(objectPath.bucket, objectPath.key);

    return {
      statusCode: 200,
      headers: {
        "content-disposition": `attachment; filename="${objectPath.key.split("/").at(-1) ?? "object"}"`,
        "content-type": object.info.contentType ?? "application/octet-stream",
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
}

function renderLoginPage(error?: string): string {
  return `<section class="auth-shell"><div class="auth-panel"><div class="auth-header"><p class="eyebrow">BentoS3 dashboard</p><h1 style="margin-top:20px">Sign in</h1><p>Manage local S3 buckets, objects, and access keys.</p></div><div class="card"><div class="card-body stack">${error ? `<p class="flash">${escapeHtml(error)}</p>` : ""}<form class="stack" method="post" action="/ui/login"><div class="field"><label for="username">Username</label><input id="username" class="input" name="username" placeholder="Username"/></div><div class="field"><label for="password">Password</label><input id="password" class="input" name="password" type="password" placeholder="Password"/></div><button class="button">Sign in</button></form></div></div></div></section>`;
}

function renderNewBucketPage(error?: string): string {
  return `${renderBreadcrumbs([{ label: "Buckets", href: "/ui/buckets" }, { label: "New" }])}${renderPageHeader("New bucket", "Create a local S3 bucket for objects and metadata.", "Storage", "")}<div class="card"><div class="card-body stack">${error ? `<p class="flash">${escapeHtml(error)}</p>` : ""}<form class="stack" method="post" action="/ui/buckets"><div class="field"><label for="bucketName">Bucket name</label><input id="bucketName" class="input" name="bucketName" placeholder="bucket-name"/><span class="help">Use an S3-compatible DNS-style bucket name.</span></div><button class="button">Create bucket</button></form></div></div>`;
}

function renderNewCredentialPage(): string {
  return `${renderBreadcrumbs([{ label: "Credentials", href: "/ui/credentials" }, { label: "New" }])}${renderPageHeader("New credential", "Generate an S3 access key for SDK and CLI clients.", "Access", "")}<div class="card"><div class="card-body"><form class="stack" method="post" action="/ui/credentials"><div class="field"><label for="accessKeyId">Access key ID</label><input id="accessKeyId" class="input" name="accessKeyId" placeholder="Access key ID, optional"/><span class="help">Leave blank to generate a secure access key ID.</span></div><button class="button">Create credential</button></form></div></div>`;
}

function renderUploadForm(bucket: string): string {
  return `<form class="stack" method="post" action="/ui/buckets/upload" enctype="multipart/form-data"><input type="hidden" name="bucket" value="${escapeHtml(bucket)}"/><div class="field"><label for="key">Object key</label><input id="key" class="input" name="key" placeholder="object/key.txt"/><span class="help">Optional for file uploads. Leave empty to use the selected file name.</span></div><div class="field"><label for="file">Upload file</label><input id="file" class="input" name="file" type="file"/><span class="help">If a file is selected, it is uploaded instead of the text body.</span></div><div class="or-label">Or create from text</div><div class="field"><label for="body">Object body</label><textarea id="body" class="textarea" name="body" placeholder="Object body"></textarea></div><button class="button">Upload object</button></form>`;
}

interface RenderPageInput {
  title: string;
  body: string;
  context: DashboardContext;
  activePath?: string;
}

function renderPage(input: RenderPageInput): string {
  const nav = input.context.user ? renderTopbar(input.context.user, input.activePath) : "";
  const content = input.context.user ? `<main class="shell"><div class="page">${input.body}</div></main>` : input.body;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)} - BentoS3</title><link rel="stylesheet" href="/ui/static/app.css"><script type="module" src="/ui/static/turbo.js"></script></head><body>${nav}${content}</body></html>`;
}

function renderTopbar(user: DashboardUser, activePath?: string): string {
  return `<header class="topbar"><div class="topbar-inner"><a class="brand" href="/ui/buckets">BentoS3</a><nav class="topnav" aria-label="Primary"><a class="${activePath === "/ui/buckets" ? "active" : ""}" href="/ui/buckets">Buckets</a><a class="${activePath === "/ui/credentials" ? "active" : ""}" href="/ui/credentials">Credentials</a></nav><div class="userbar"><span>${escapeHtml(user.username)}</span><form method="post" action="/ui/logout"><button class="button secondary">Logout</button></form></div></div></header>`;
}

function renderBreadcrumbs(items: { label: string; href?: string }[]): string {
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${items
    .map((item, index) => {
      const separator = index === 0 ? "" : `<span>/</span>`;
      const label = item.href
        ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`
        : `<span>${escapeHtml(item.label)}</span>`;

      return `${separator}${label}`;
    })
    .join("")}</nav>`;
}

function renderPageHeader(title: string, description: string, eyebrow: string, actions: string): string {
  return `<header class="hero"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div>${actions ? `<div class="row">${actions}</div>` : ""}</header>`;
}

function renderStatCard(label: string, value: string): string {
  return `<article class="stat-card"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value)}</span></article>`;
}

function renderEmptyState(title: string, description: string, action: string): string {
  return `<div class="empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${action}</div>`;
}

async function readForm(request: BentoRequest): Promise<URLSearchParams> {
  const chunks: Uint8Array[] = [];

  if (!request.body) {
    return new URLSearchParams();
  }

  for await (const chunk of request.body) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
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
  const file = parts.find((part) => part.name === "file" && part.filename && part.body.byteLength > 0);
  const key = requestedKey.length > 0 ? requestedKey : file?.filename ?? "";

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
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
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
  const marker = "/objects/";
  const markerIndex = path.indexOf(marker);

  if (markerIndex === -1 || !path.endsWith("/delete")) {
    return undefined;
  }

  return {
    bucket: decodeURIComponent(path.slice("/ui/buckets/".length, markerIndex)),
    key: decodeURIComponent(path.slice(markerIndex + marker.length, -"/delete".length)),
  };
}

function parseObjectPath(path: string): { bucket: string; key: string } | undefined {
  const marker = "/objects/";
  const markerIndex = path.indexOf(marker);

  if (markerIndex === -1) {
    return undefined;
  }

  return {
    bucket: decodeURIComponent(path.slice("/ui/buckets/".length, markerIndex)),
    key: decodeURIComponent(path.slice(markerIndex + marker.length)),
  };
}

function readCookie(request: BentoRequest, name: string): string | undefined {
  const cookieHeader = request.headers[HEADER_COOKIE];
  const cookie = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;

  return cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
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

function textResponse(body: string, contentType: string): BentoResponse {
  return { statusCode: 200, headers: { [HEADER_CONTENT_TYPE]: contentType }, body };
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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
