import type { BentoHandler, BentoRequest, BentoResponse } from "./types.js";
import { classifyBentoRoute } from "./router.js";
import { createNotImplementedResponse } from "../s3/errors.js";
import { handleS3Request } from "../s3/operations.js";
import { MemoryAuthStore } from "../auth/memory-auth-store.js";
import { validateS3RequestAuth } from "../auth/sigv4.js";
import type { AuthStore } from "../auth/types.js";
import { MemoryStorageDriver } from "../storage/memory-storage-driver.js";
import type { BucketInfo, StorageDriver } from "../storage/types.js";

const ADMIN_NOT_IMPLEMENTED_MESSAGE = "Admin API routes are not implemented in phase 1.";
const DASHBOARD_NOT_IMPLEMENTED_MESSAGE = "Dashboard routes are not implemented in phase 1.";

export interface BentoS3CoreOptions {
  buckets?: BucketInfo[];
  storage?: StorageDriver;
  authStore?: AuthStore;
  auth?: {
    enabled?: boolean;
  };
}

export class BentoS3Core implements BentoHandler {
  private readonly storage: StorageDriver;
  private readonly authStore: AuthStore;
  private readonly isAuthEnabled: boolean;

  public constructor(options: BentoS3CoreOptions = {}) {
    this.storage = options.storage ?? new MemoryStorageDriver(options.buckets);
    this.authStore = options.authStore ?? new MemoryAuthStore();
    this.isAuthEnabled = options.auth?.enabled ?? true;
  }

  public async handle(request: BentoRequest): Promise<BentoResponse> {
    const route = classifyBentoRoute(request);

    if (route.kind === "admin") {
      return Promise.resolve(createNotImplementedResponse(ADMIN_NOT_IMPLEMENTED_MESSAGE));
    }

    if (route.kind === "dashboard") {
      return Promise.resolve(createNotImplementedResponse(DASHBOARD_NOT_IMPLEMENTED_MESSAGE));
    }

    if (this.isAuthEnabled) {
      const authErrorResponse = await validateS3RequestAuth(request, this.authStore);

      if (authErrorResponse) {
        return authErrorResponse;
      }
    }

    return handleS3Request(request, route, this.storage);
  }
}
