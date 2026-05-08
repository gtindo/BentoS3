#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { BentoS3 } from "../node/bento-s3.js";
import { JsonAuthStore } from "../auth/json-auth-store.js";
import { FileSystemStorageDriver } from "../storage/file-system-storage-driver.js";
import { JsonDashboardStore } from "../dashboard/json-dashboard-store.js";

const DEFAULT_ACCESS_KEY_ID = "bentos3";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9000;
const DEFAULT_ROOT_DIR = "./.bentos3";

interface ParsedArgs {
  command: string[];
  options: Map<string, string | boolean>;
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const [domain, action, subject] = args.command;
  const rootDir = readStringOption(args, "root-dir", DEFAULT_ROOT_DIR);

  if (domain === "serve") {
    await serve(args, rootDir);
    return;
  }

  if (domain === "user" && action === "create" && subject) {
    await createDashboardUser(rootDir, subject, readStringOption(args, "password", createPassword()));
    return;
  }

  if (domain === "user" && action === "list") {
    await listDashboardUsers(rootDir);
    return;
  }

  if (domain === "bucket" && action === "list") {
    await listBuckets(rootDir);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

async function serve(args: ParsedArgs, rootDir: string): Promise<void> {
  const host = readStringOption(args, "host", DEFAULT_HOST);
  const port = readNumberOption(args, "port", DEFAULT_PORT);
  const authStore = new JsonAuthStore({ rootDir });
  const bootstrappedCredential = await bootstrapDefaultCredential(authStore);
  const server = new BentoS3({ host, port, rootDir, authStore });

  await server.start();

  if (!server.endpoint) {
    throw new Error("Server did not expose an endpoint after startup.");
  }

  console.log(`BentoS3 listening at ${server.endpoint}`);
  console.log(`Dashboard available at ${server.endpoint}/ui`);

  if (bootstrappedCredential) {
    console.log(`Created default access key: ${bootstrappedCredential.accessKeyId}`);
    console.log(`Created default secret key: ${bootstrappedCredential.secretAccessKey}`);
  }

  await waitForShutdown(server);
}

async function createDashboardUser(rootDir: string, username: string, password: string): Promise<void> {
  const store = new JsonDashboardStore({ rootDir });
  await store.createUser({ username, password });

  console.log(`Created dashboard user: ${username}`);
  console.log(`Password: ${password}`);
}

async function listDashboardUsers(rootDir: string): Promise<void> {
  const users = await new JsonDashboardStore({ rootDir }).listUsers();

  for (const user of users) {
    console.log(`${user.username}\t${user.createdAt.toISOString()}`);
  }
}

async function listBuckets(rootDir: string): Promise<void> {
  const buckets = await new FileSystemStorageDriver({ rootDir }).listBuckets();

  for (const bucket of buckets) {
    console.log(`${bucket.name}\t${bucket.createdAt.toISOString()}`);
  }
}

async function bootstrapDefaultCredential(authStore: JsonAuthStore): Promise<{ accessKeyId: string; secretAccessKey: string } | undefined> {
  const credentials = await authStore.listCredentials();

  if (credentials.length > 0) {
    return undefined;
  }

  return authStore.createCredential({
    accessKeyId: DEFAULT_ACCESS_KEY_ID,
    secretAccessKey: randomBytes(24).toString("base64url"),
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const options = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg?.startsWith("--")) {
      if (arg) {
        command.push(arg);
      }
      continue;
    }

    const name = arg.slice(2);
    const next = argv[index + 1];

    if (next && !next.startsWith("--")) {
      options.set(name, next);
      index += 1;
    } else {
      options.set(name, true);
    }
  }

  return { command, options };
}

function readStringOption(args: ParsedArgs, name: string, fallback: string): string {
  const value = args.options.get(name);

  return typeof value === "string" ? value : fallback;
}

function readNumberOption(args: ParsedArgs, name: string, fallback: number): number {
  const value = args.options.get(name);

  if (typeof value !== "string") {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function createPassword(): string {
  return process.env.BENTOS3_PASSWORD ?? randomBytes(16).toString("base64url");
}

function waitForShutdown(server: BentoS3): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      void server.stop().finally(resolve);
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function printUsage(): void {
  console.error("Usage:");
  console.error("  bentos3 serve [--host 127.0.0.1] [--port 9000] [--root-dir ./.bentos3]");
  console.error("  bentos3 user create <username> [--password password] [--root-dir ./.bentos3]");
  console.error("  bentos3 user list [--root-dir ./.bentos3]");
  console.error("  bentos3 bucket list [--root-dir ./.bentos3]");
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed.");
  process.exitCode = 1;
});
