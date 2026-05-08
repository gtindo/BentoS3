import type { BentoHandler, BentoRequest, BentoResponse } from "./types.js";
import { classifyBentoRoute } from "./router.js";
import { createNotImplementedResponse } from "../s3/errors.js";
import { type BucketRecord, handleS3Request } from "../s3/operations.js";

const ADMIN_NOT_IMPLEMENTED_MESSAGE = "Admin API routes are not implemented in phase 1.";
const DASHBOARD_NOT_IMPLEMENTED_MESSAGE = "Dashboard routes are not implemented in phase 1.";

export interface BentoS3CoreOptions {
  buckets?: BucketRecord[];
}

export class BentoS3Core implements BentoHandler {
  private readonly buckets: Map<string, BucketRecord>;

  public constructor(options: BentoS3CoreOptions = {}) {
    this.buckets = new Map(options.buckets?.map((bucket) => [bucket.name, bucket]));
  }

  public handle(request: BentoRequest): Promise<BentoResponse> {
    const route = classifyBentoRoute(request);

    if (route.kind === "admin") {
      return Promise.resolve(createNotImplementedResponse(ADMIN_NOT_IMPLEMENTED_MESSAGE));
    }

    if (route.kind === "dashboard") {
      return Promise.resolve(createNotImplementedResponse(DASHBOARD_NOT_IMPLEMENTED_MESSAGE));
    }

    return Promise.resolve(handleS3Request(request.method.toUpperCase(), route, this.buckets));
  }
}
