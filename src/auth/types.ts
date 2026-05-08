export interface AuthStore {
  getCredential(accessKeyId: string): Promise<AuthCredential | undefined>;
  listCredentials(): Promise<AuthCredential[]>;
  createCredential(input: CreateCredentialInput): Promise<AuthCredential>;
  disableCredential(accessKeyId: string): Promise<void>;
  deleteCredential(accessKeyId: string): Promise<void>;
}

export interface AuthCredential {
  accessKeyId: string;
  secretAccessKey: string;
  enabled: boolean;
  createdAt: Date;
  disabledAt?: Date;
}

export interface CreateCredentialInput {
  accessKeyId: string;
  secretAccessKey: string;
}
