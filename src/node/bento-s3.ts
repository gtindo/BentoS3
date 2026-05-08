import { createServer, type Server } from "node:http";
import { BentoS3Core, type BentoS3CoreOptions } from "../core/bento-s3-core.js";
import type { BentoHandler } from "../core/types.js";
import { handleNodeHttpRequest } from "./http-adapter.js";
import { JsonAuthStore } from "../auth/json-auth-store.js";
import type { AuthStore } from "../auth/types.js";
import { FileSystemStorageDriver } from "../storage/file-system-storage-driver.js";
import { MemoryStorageDriver } from "../storage/memory-storage-driver.js";
import type { StorageDriver } from "../storage/types.js";
import { JsonDashboardStore } from "../dashboard/json-dashboard-store.js";
import { DashboardRouter } from "../dashboard/router.js";
import { MemoryAuthStore } from "../auth/memory-auth-store.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9000;
const HTTP_PROTOCOL = "http";
const DEFAULT_ROOT_DIR = "./.bentos3";

export interface BentoS3Options extends BentoS3CoreOptions {
  host?: string;
  port?: number;
  rootDir?: string;
  handler?: BentoHandler;
  dashboard?: {
    enabled?: boolean;
  };
}

export class BentoS3 {
  private readonly host: string;
  private readonly requestedPort: number;
  private readonly handler: BentoHandler;
  private server: Server | undefined;
  private assignedPort: number | undefined;

  public constructor(options: BentoS3Options = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.requestedPort = options.port ?? DEFAULT_PORT;
    this.handler = options.handler ?? createDefaultHandler(options);
  }

  public get port(): number | undefined {
    return this.assignedPort;
  }

  public get endpoint(): string | undefined {
    if (this.assignedPort === undefined) {
      return undefined;
    }

    return `${HTTP_PROTOCOL}://${this.host}:${String(this.assignedPort)}`;
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer((request, response) => {
      void handleNodeHttpRequest(this.handler, request, response).catch((error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "Internal Server Error");
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.requestedPort, this.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    this.server = server;
    this.assignedPort = readServerPort(server);
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    this.assignedPort = undefined;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function createDefaultHandler(options: BentoS3Options): BentoHandler {
  const rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
  const storage =
    options.storage ??
    (options.rootDir ? new FileSystemStorageDriver({ rootDir }) : new MemoryStorageDriver(options.buckets));
  const authStore = options.authStore ?? (options.rootDir ? new JsonAuthStore({ rootDir }) : new MemoryAuthStore());
  const core = new BentoS3Core(createCoreOptions(options, storage, authStore));

  if (options.dashboard?.enabled === false) {
    return core;
  }

  const dashboard = new DashboardRouter({
    authStore,
    dashboardStore: new JsonDashboardStore({ rootDir }),
    storage,
  });

  return {
    async handle(request) {
      if (request.path === "/ui" || request.path.startsWith("/ui/")) {
        return dashboard.handle(request);
      }

      return core.handle(request);
    },
  };
}

function createCoreOptions(
  options: BentoS3Options,
  storage: StorageDriver,
  authStore: AuthStore,
): BentoS3CoreOptions {
  return {
    ...options,
    storage,
    authStore,
  };
}


export function readServerPort(server: Server): number {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("BentoS3 server did not bind to a TCP address.");
  }

  return address.port;
}
