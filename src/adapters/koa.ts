import type Koa from "koa";
import type { BentoHandler } from "../core/types.js";
import { createBentoRequestFromNodeRequest, writeNodeHttpResponse } from "../node/http-adapter.js";
import { resolveAdapterPath, type AdapterPathOptions } from "./path.js";

export type KoaBentoS3Options = AdapterPathOptions;

export function koaAdapter(handler: BentoHandler, options: KoaBentoS3Options = {}): Koa.Middleware {
  return async function handleKoaBentoS3Request(context): Promise<void> {
    const path = resolveAdapterPath(context.originalUrl, options);
    const bentoRequest = createBentoRequestFromNodeRequest(context.req, path);
    const bentoResponse = await handler.handle(bentoRequest);

    context.respond = false;
    await writeNodeHttpResponse(context.res, bentoResponse);
  };
}
