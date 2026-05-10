import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthCredential, AuthStore, CreateCredentialInput } from "./types.js";

const AUTH_DIRECTORY = "auth";
const BENTO_ROOT_DIRECTORY = ".bentos3";
const CREDENTIALS_FILE = "credentials.json";
const JSON_INDENT = 2;
const STORE_VERSION = 1;
const TEMP_DIRECTORY = "tmp";

interface JsonAuthStoreOptions {
  rootDir: string;
}

interface CredentialStoreFile {
  version: number;
  credentials: SerializedAuthCredential[];
}

interface SerializedAuthCredential {
  accessKeyId: string;
  secretAccessKey: string;
  enabled: boolean;
  createdAt: string;
  disabledAt?: string;
}

export class JsonAuthStore implements AuthStore {
  private readonly credentialsPath: string;
  private readonly tmpDir: string;

  public constructor(options: JsonAuthStoreOptions) {
    const rootDir = resolve(options.rootDir, BENTO_ROOT_DIRECTORY);
    this.credentialsPath = join(rootDir, AUTH_DIRECTORY, CREDENTIALS_FILE);
    this.tmpDir = join(rootDir, TEMP_DIRECTORY);
  }

  public async getCredential(accessKeyId: string): Promise<AuthCredential | undefined> {
    return (await this.listCredentials()).find(
      (credential) => credential.accessKeyId === accessKeyId,
    );
  }

  public async listCredentials(): Promise<AuthCredential[]> {
    const file = await this.readStoreFile();

    return file.credentials.map(deserializeCredential);
  }

  public async createCredential(input: CreateCredentialInput): Promise<AuthCredential> {
    const file = await this.readStoreFile();
    const existingCredentialIndex = file.credentials.findIndex(
      (credential) => credential.accessKeyId === input.accessKeyId,
    );
    const credential: AuthCredential = {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      enabled: true,
      createdAt: new Date(),
    };
    const serializedCredential = serializeCredential(credential);

    if (existingCredentialIndex === -1) {
      file.credentials.push(serializedCredential);
    } else {
      file.credentials[existingCredentialIndex] = serializedCredential;
    }

    await this.writeStoreFile(file);

    return credential;
  }

  public async disableCredential(accessKeyId: string): Promise<void> {
    const file = await this.readStoreFile();
    const credential = file.credentials.find((candidate) => candidate.accessKeyId === accessKeyId);

    if (!credential?.enabled) {
      return;
    }

    credential.enabled = false;
    credential.disabledAt = new Date().toISOString();
    await this.writeStoreFile(file);
  }

  public async deleteCredential(accessKeyId: string): Promise<void> {
    const file = await this.readStoreFile();
    const credentials = file.credentials.filter(
      (credential) => credential.accessKeyId !== accessKeyId,
    );

    await this.writeStoreFile({ ...file, credentials });
  }

  private async readStoreFile(): Promise<CredentialStoreFile> {
    try {
      const file = JSON.parse(await readFile(this.credentialsPath, "utf8")) as CredentialStoreFile;

      return { version: file.version, credentials: file.credentials };
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return { version: STORE_VERSION, credentials: [] };
      }

      throw error;
    }
  }

  private async writeStoreFile(file: CredentialStoreFile): Promise<void> {
    await mkdir(dirname(this.credentialsPath), { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });

    const tmpPath = join(this.tmpDir, randomUUID());
    await writeFile(tmpPath, `${JSON.stringify(file, null, JSON_INDENT)}\n`);
    await rename(tmpPath, this.credentialsPath).catch(async (error: unknown) => {
      await rm(tmpPath, { force: true });
      throw error;
    });
  }
}

function serializeCredential(credential: AuthCredential): SerializedAuthCredential {
  return {
    accessKeyId: credential.accessKeyId,
    secretAccessKey: credential.secretAccessKey,
    enabled: credential.enabled,
    createdAt: credential.createdAt.toISOString(),
    ...(credential.disabledAt ? { disabledAt: credential.disabledAt.toISOString() } : {}),
  };
}

function deserializeCredential(credential: SerializedAuthCredential): AuthCredential {
  return {
    accessKeyId: credential.accessKeyId,
    secretAccessKey: credential.secretAccessKey,
    enabled: credential.enabled,
    createdAt: new Date(credential.createdAt),
    ...(credential.disabledAt ? { disabledAt: new Date(credential.disabledAt) } : {}),
  };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
