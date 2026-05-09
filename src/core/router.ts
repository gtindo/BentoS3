import type { BentoRequest } from "./types.js";

const ADMIN_PATH_PREFIX = "/admin";
const DASHBOARD_PATH_PREFIX = "/ui";
const ROOT_PATH = "/";
const RESERVED_ROUTE_DEFINITIONS: ReservedRouteDefinition[] = [
  { kind: "admin", pathPrefix: ADMIN_PATH_PREFIX },
  { kind: "dashboard", pathPrefix: DASHBOARD_PATH_PREFIX },
];

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

interface ReservedRouteDefinition {
  kind: "admin" | "dashboard";
  pathPrefix: string;
}

export function classifyBentoRoute(request: BentoRequest): BentoRoute {
  const reservedRoute = RESERVED_ROUTE_DEFINITIONS.find((definition) =>
    matchesPathPrefix(request.path, definition.pathPrefix),
  );

  if (reservedRoute) {
    return { kind: reservedRoute.kind };
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

function matchesPathPrefix(path: string, pathPrefix: string): boolean {
  return path === pathPrefix || path.startsWith(`${pathPrefix}/`);
}
