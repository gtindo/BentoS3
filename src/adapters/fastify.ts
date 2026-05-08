import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import type { BentoHandler } from "../core/types.js";
import { createBentoRequestFromNodeRequest, writeNodeHttpResponse } from "../node/http-adapter.js";
import { resolveAdapterPath, type AdapterPathOptions } from "./path.js";

const ALL_METHODS = ["DELETE", "GET", "HEAD", "POST", "PUT"];
const ROOT_ROUTE = "/";
const WILDCARD_ROUTE = "/*";

export interface FastifyBentoS3Options extends AdapterPathOptions {
  bento: BentoHandler;
}

export const fastifyBentoS3: FastifyPluginCallback<FastifyBentoS3Options> = (
  fastify,
  options,
  done,
) => {
  registerRawContentTypeParser(fastify);

  for (const url of [ROOT_ROUTE, WILDCARD_ROUTE]) {
    fastify.route({
      method: ALL_METHODS,
      url,
      handler: async (request, reply) => {
        await handleFastifyBentoS3Request(request, reply, options);
      },
    });
  }

  done();
};

export async function handleFastifyBentoS3Request(
  request: FastifyRequest,
  reply: FastifyReply,
  options: FastifyBentoS3Options,
): Promise<void> {
  const path = resolveAdapterPath(request.raw.url ?? request.url, options);
  const bentoRequest = createBentoRequestFromNodeRequest(request.raw, path);
  const bentoResponse = await options.bento.handle(bentoRequest);

  reply.hijack();
  await writeNodeHttpResponse(reply.raw, bentoResponse);
}

function registerRawContentTypeParser(fastify: FastifyInstance): void {
  fastify.addContentTypeParser("*", (_request, payload, done) => {
    done(null, payload);
  });
}
