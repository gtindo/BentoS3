import type { BentoRequest } from "./types.js";

const ADMIN_PATH_PREFIX = "/admin";
const DASHBOARD_PATH_PREFIX = "/dashboard";
const ROOT_PATH = "/";

export type RouteKind = "admin" | "dashboard" | "s3";

export interface S3Route {
  kind: "s3";
  bucket?: string;
  key?: string;
}

export interface AdminRoute {
  kind: "admin";
}

export interface DashboardRoute {
  kind: "dashboard";
}

export type BentoRoute = AdminRoute | DashboardRoute | S3Route;

export function classifyBentoRoute(request: BentoRequest): BentoRoute {
  if (request.path === ADMIN_PATH_PREFIX || request.path.startsWith(`${ADMIN_PATH_PREFIX}/`)) {
    return { kind: "admin" };
  }

  if (
    request.path === DASHBOARD_PATH_PREFIX ||
    request.path.startsWith(`${DASHBOARD_PATH_PREFIX}/`)
  ) {
    return { kind: "dashboard" };
  }

  return parseS3Route(request.path);
}

export function parseS3Route(path: string): S3Route {
  if (path === ROOT_PATH || path === "") {
    return { kind: "s3" };
  }

  const pathWithoutLeadingSlash = path.startsWith(ROOT_PATH) ? path.slice(1) : path;
  const [rawBucket, ...keyParts] = pathWithoutLeadingSlash.split("/");
  const bucket = rawBucket ? decodeURIComponent(rawBucket) : undefined;
  const rawKey = keyParts.join("/");
  const key = rawKey.length > 0 ? decodeURIComponent(rawKey) : undefined;
  const route: S3Route = { kind: "s3" };

  if (bucket) {
    route.bucket = bucket;
  }

  if (key) {
    route.key = key;
  }

  return route;
}
