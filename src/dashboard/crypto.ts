import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_ENCODING = "base64";
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_N = 16_384;
const SCRYPT_P = 1;
const SCRYPT_R = 8;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

export interface PasswordHash {
  algorithm: "scrypt";
  salt: string;
  hash: string;
  keyLength: number;
  cost: {
    N: number;
    r: number;
    p: number;
  };
}

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(SALT_BYTES).toString(HASH_ENCODING);
  const hash = deriveHash(password, salt, PASSWORD_KEY_LENGTH);

  return {
    algorithm: "scrypt",
    salt,
    hash,
    keyLength: PASSWORD_KEY_LENGTH,
    cost: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
  };
}

export function verifyPassword(password: string, passwordHash: PasswordHash): boolean {
  const hash = deriveHash(password, passwordHash.salt, passwordHash.keyLength);
  const expectedHash = Buffer.from(passwordHash.hash, HASH_ENCODING);
  const actualHash = Buffer.from(hash, HASH_ENCODING);

  if (expectedHash.byteLength !== actualHash.byteLength) {
    return false;
  }

  return timingSafeEqual(expectedHash, actualHash);
}

export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString(HASH_ENCODING);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest(HASH_ENCODING);
}

export function verifySessionToken(token: string, tokenHash: string): boolean {
  const expectedTokenHash = Buffer.from(tokenHash, HASH_ENCODING);
  const actualTokenHash = Buffer.from(hashSessionToken(token), HASH_ENCODING);

  if (expectedTokenHash.byteLength !== actualTokenHash.byteLength) {
    return false;
  }

  return timingSafeEqual(expectedTokenHash, actualTokenHash);
}

function deriveHash(password: string, salt: string, keyLength: number): string {
  const key = scryptSync(password, salt, keyLength, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return key.toString(HASH_ENCODING);
}
