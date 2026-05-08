import type { AuthCredential, AuthStore, CreateCredentialInput } from "./types.js";

export class MemoryAuthStore implements AuthStore {
  private readonly credentials = new Map<string, AuthCredential>();

  public constructor(credentials: AuthCredential[] = []) {
    for (const credential of credentials) {
      this.credentials.set(credential.accessKeyId, cloneCredential(credential));
    }
  }

  public getCredential(accessKeyId: string): Promise<AuthCredential | undefined> {
    const credential = this.credentials.get(accessKeyId);

    return Promise.resolve(credential ? cloneCredential(credential) : undefined);
  }

  public listCredentials(): Promise<AuthCredential[]> {
    return Promise.resolve([...this.credentials.values()].map(cloneCredential));
  }

  public createCredential(input: CreateCredentialInput): Promise<AuthCredential> {
    const credential: AuthCredential = {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      enabled: true,
      createdAt: new Date(),
    };

    this.credentials.set(input.accessKeyId, credential);

    return Promise.resolve(cloneCredential(credential));
  }

  public disableCredential(accessKeyId: string): Promise<void> {
    const credential = this.credentials.get(accessKeyId);

    if (!credential?.enabled) {
      return Promise.resolve();
    }

    this.credentials.set(accessKeyId, { ...credential, enabled: false, disabledAt: new Date() });

    return Promise.resolve();
  }

  public deleteCredential(accessKeyId: string): Promise<void> {
    this.credentials.delete(accessKeyId);

    return Promise.resolve();
  }
}

function cloneCredential(credential: AuthCredential): AuthCredential {
  return {
    accessKeyId: credential.accessKeyId,
    secretAccessKey: credential.secretAccessKey,
    enabled: credential.enabled,
    createdAt: new Date(credential.createdAt),
    ...(credential.disabledAt ? { disabledAt: new Date(credential.disabledAt) } : {}),
  };
}
