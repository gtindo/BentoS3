import type { NextFunction, Request, Response } from "express";
import type { BentoHandler } from "../core/types.js";
import { createBentoRequestFromNodeRequest, writeNodeHttpResponse } from "../node/http-adapter.js";
import { resolveAdapterPath, type AdapterPathOptions } from "./path.js";

export type ExpressBentoS3Options = AdapterPathOptions;

export function expressAdapter(handler: BentoHandler, options: ExpressBentoS3Options = {}) {
  return async function handleExpressBentoS3Request(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const basePath = options.basePath ?? request.baseUrl;
      const path = resolveAdapterPath(request.originalUrl, { basePath });
      const bentoRequest = createBentoRequestFromNodeRequest(request, path);
      const bentoResponse = await handler.handle(bentoRequest);

      await writeNodeHttpResponse(response, bentoResponse);
    } catch (error) {
      next(error);
    }
  };
}
