import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
  verifySessionToken,
  type PasswordHash,
} from "./crypto.js";

const AUTH_DIRECTORY = "auth";
const BENTO_ROOT_DIRECTORY = ".bentos3";
const DASHBOARD_USERS_FILE = "dashboard-users.json";
const JSON_INDENT = 2;
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const SESSIONS_FILE = "sessions.json";
const STORE_VERSION = 1;
const TEMP_DIRECTORY = "tmp";

export interface DashboardUser {
  id: string;
  username: string;
  createdAt: Date;
}

export interface CreateDashboardUserInput {
  username: string;
  password: string;
}

interface JsonDashboardStoreOptions {
  rootDir: string;
}

interface SerializedDashboardUser {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  passwordAlgorithm: "scrypt";
  passwordKeyLength: number;
  passwordCost: {
    N: number;
    r: number;
    p: number;
  };
  createdAt: string;
}

interface DashboardUsersFile {
  version: number;
  users: SerializedDashboardUser[];
}

interface SerializedDashboardSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
}

interface DashboardSessionsFile {
  version: number;
  sessions: SerializedDashboardSession[];
}

export class JsonDashboardStore {
  private readonly sessionsPath: string;
  private readonly tmpDir: string;
  private readonly usersPath: string;

  public constructor(options: JsonDashboardStoreOptions) {
    const rootDir = resolve(options.rootDir, BENTO_ROOT_DIRECTORY);

    this.sessionsPath = join(rootDir, AUTH_DIRECTORY, SESSIONS_FILE);
    this.tmpDir = join(rootDir, TEMP_DIRECTORY);
    this.usersPath = join(rootDir, AUTH_DIRECTORY, DASHBOARD_USERS_FILE);
  }

  public async listUsers(): Promise<DashboardUser[]> {
    const file = await this.readUsersFile();

    return file.users.map(deserializeUser);
  }

  public async createUser(input: CreateDashboardUserInput): Promise<DashboardUser> {
    const file = await this.readUsersFile();
    const existingUserIndex = file.users.findIndex((user) => user.username === input.username);
    const password = hashPassword(input.password);
    const user: SerializedDashboardUser = {
      id:
        existingUserIndex === -1
          ? `user_${randomUUID()}`
          : (file.users[existingUserIndex]?.id ?? `user_${randomUUID()}`),
      username: input.username,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordAlgorithm: password.algorithm,
      passwordKeyLength: password.keyLength,
      passwordCost: password.cost,
      createdAt:
        existingUserIndex === -1
          ? new Date().toISOString()
          : (file.users[existingUserIndex]?.createdAt ?? new Date().toISOString()),
    };

    if (existingUserIndex === -1) {
      file.users.push(user);
    } else {
      file.users[existingUserIndex] = user;
    }

    await this.writeJsonFile(this.usersPath, file);

    return deserializeUser(user);
  }

  public async authenticateUser(
    username: string,
    password: string,
  ): Promise<DashboardUser | undefined> {
    const file = await this.readUsersFile();
    const user = file.users.find((candidate) => candidate.username === username);

    if (!user) {
      return undefined;
    }

    const passwordHash: PasswordHash = {
      algorithm: user.passwordAlgorithm,
      salt: user.passwordSalt,
      hash: user.passwordHash,
      keyLength: user.passwordKeyLength,
      cost: user.passwordCost,
    };
    const hasValidPassword = verifyPassword(password, passwordHash);

    return hasValidPassword ? deserializeUser(user) : undefined;
  }

  public async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const file = await this.readSessionsFile();
    const token = createSessionToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

    file.sessions.push({
      id: `session_${randomUUID()}`,
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    await this.writeJsonFile(this.sessionsPath, pruneExpiredSessions(file));

    return { token, expiresAt };
  }

  public async getUserBySessionToken(token: string): Promise<DashboardUser | undefined> {
    const sessionsFile = pruneExpiredSessions(await this.readSessionsFile());
    const session = sessionsFile.sessions.find((candidate) =>
      verifySessionToken(token, candidate.tokenHash),
    );

    if (!session) {
      return undefined;
    }

    const usersFile = await this.readUsersFile();
    const user = usersFile.users.find((candidate) => candidate.id === session.userId);

    return user ? deserializeUser(user) : undefined;
  }

  public async deleteSession(token: string): Promise<void> {
    const file = await this.readSessionsFile();
    const sessions = file.sessions.filter(
      (session) => !verifySessionToken(token, session.tokenHash),
    );

    await this.writeJsonFile(this.sessionsPath, { ...file, sessions });
  }

  private async readUsersFile(): Promise<DashboardUsersFile> {
    try {
      const file = JSON.parse(await readFile(this.usersPath, "utf8")) as DashboardUsersFile;
      return { version: file.version, users: file.users };
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return { version: STORE_VERSION, users: [] };
      }

      throw error;
    }
  }

  private async readSessionsFile(): Promise<DashboardSessionsFile> {
    try {
      const file = JSON.parse(await readFile(this.sessionsPath, "utf8")) as DashboardSessionsFile;
      return { version: file.version, sessions: file.sessions };
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return { version: STORE_VERSION, sessions: [] };
      }

      throw error;
    }
  }

  private async writeJsonFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });

    const tmpPath = join(this.tmpDir, randomUUID());
    await writeFile(tmpPath, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
    await rename(tmpPath, path).catch(async (error: unknown) => {
      await rm(tmpPath, { force: true });
      throw error;
    });
  }
}

function deserializeUser(user: SerializedDashboardUser): DashboardUser {
  return { id: user.id, username: user.username, createdAt: new Date(user.createdAt) };
}

function pruneExpiredSessions(file: DashboardSessionsFile): DashboardSessionsFile {
  const now = Date.now();
  const sessions = file.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);

  return { ...file, sessions };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
