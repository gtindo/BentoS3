const EMPTY_PATH = "";
const ROOT_PATH = "/";

export interface AdapterPathOptions {
  basePath?: string;
}

export interface AdapterPathResult {
  url: string;
  path: string;
  canonicalPath?: string;
}

export function resolveAdapterPath(
  rawUrl: string,
  options: AdapterPathOptions = {},
): AdapterPathResult {
  const url = new URL(rawUrl, "http://bentos3.local");
  const normalizedBasePath = normalizeBasePath(options.basePath);
  const path = normalizedBasePath ? stripBasePath(url.pathname, normalizedBasePath) : url.pathname;
  const result: AdapterPathResult = {
    url: `${path}${url.search}`,
    path,
  };

  if (path !== url.pathname) {
    result.canonicalPath = url.pathname;
  }

  return result;
}

export function normalizeBasePath(basePath: string | undefined): string | undefined {
  if (!basePath || basePath === ROOT_PATH) {
    return undefined;
  }

  const withLeadingSlash = basePath.startsWith(ROOT_PATH) ? basePath : `${ROOT_PATH}${basePath}`;

  return withLeadingSlash.endsWith(ROOT_PATH) ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

function stripBasePath(path: string, basePath: string): string {
  if (path === basePath) {
    return ROOT_PATH;
  }

  if (!path.startsWith(`${basePath}${ROOT_PATH}`)) {
    return path;
  }

  return path.slice(basePath.length) || EMPTY_PATH;
}
