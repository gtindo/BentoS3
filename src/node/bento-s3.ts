import { createServer, type Server } from "node:http";
import { BentoS3Core, type BentoS3CoreOptions } from "../core/bento-s3-core.js";
import type { BentoHandler } from "../core/types.js";
import { handleNodeHttpRequest } from "./http-adapter.js";
import { JsonAuthStore } from "../auth/json-auth-store.js";
import { FileSystemStorageDriver } from "../storage/file-system-storage-driver.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9000;
const HTTP_PROTOCOL = "http";

export interface BentoS3Options extends BentoS3CoreOptions {
  host?: string;
  port?: number;
  rootDir?: string;
  handler?: BentoHandler;
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
    this.handler = options.handler ?? new BentoS3Core(createCoreOptions(options));
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

function createCoreOptions(options: BentoS3Options): BentoS3CoreOptions {
  if (!options.rootDir) {
    return options;
  }

  return {
    ...options,
    storage: options.storage ?? new FileSystemStorageDriver({ rootDir: options.rootDir }),
    authStore: options.authStore ?? new JsonAuthStore({ rootDir: options.rootDir }),
  };
}

export function readServerPort(server: Server): number {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("BentoS3 server did not bind to a TCP address.");
  }

  return address.port;
}
