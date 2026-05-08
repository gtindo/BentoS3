import type { BentoHandler, BentoRequest, BentoResponse } from "./types.js";
import { classifyBentoRoute } from "./router.js";
import { createNotImplementedResponse } from "../s3/errors.js";
import { handleS3Request } from "../s3/operations.js";
import { MemoryStorageDriver } from "../storage/memory-storage-driver.js";
import type { BucketInfo, StorageDriver } from "../storage/types.js";

const ADMIN_NOT_IMPLEMENTED_MESSAGE = "Admin API routes are not implemented in phase 1.";
const DASHBOARD_NOT_IMPLEMENTED_MESSAGE = "Dashboard routes are not implemented in phase 1.";

export interface BentoS3CoreOptions {
  buckets?: BucketInfo[];
  storage?: StorageDriver;
}

export class BentoS3Core implements BentoHandler {
  private readonly storage: StorageDriver;

  public constructor(options: BentoS3CoreOptions = {}) {
    this.storage = options.storage ?? new MemoryStorageDriver(options.buckets);
  }

  public handle(request: BentoRequest): Promise<BentoResponse> {
    const route = classifyBentoRoute(request);

    if (route.kind === "admin") {
      return Promise.resolve(createNotImplementedResponse(ADMIN_NOT_IMPLEMENTED_MESSAGE));
    }

    if (route.kind === "dashboard") {
      return Promise.resolve(createNotImplementedResponse(DASHBOARD_NOT_IMPLEMENTED_MESSAGE));
    }

    return handleS3Request(request, route, this.storage);
  }
}
