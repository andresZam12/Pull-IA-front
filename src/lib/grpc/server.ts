/**
 * PULL-IA / SoftStack • Deplhoy — Native gRPC Server (`@grpc/grpc-js`)
 *
 * Implements `pullia.pipeline.v1.NewsPipelineService` defined in `proto/pullia.proto`:
 *   - `StreamSyncProgress`: Server-Side Streaming RPC (`returns (stream SyncProgressEvent)`)
 *   - `GetPipelineStatus`: Unary RPC (`returns (PipelineStatusResponse)`)
 *
 * Can run standalone on port 50051 (`npm run grpc:server`) for testing with Postman gRPC / grpcurl.
 */

import path from "path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { IngestionPipeline } from "@/lib/pipeline/ingest";
import { encodeSyncProgressFrame } from "@/lib/grpc/proto-schema";
import prisma from "@/lib/db/prisma";

const PROTO_PATH = path.join(process.cwd(), "proto", "pullia.proto");

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const pulliaPackage = protoDescriptor.pullia.pipeline.v1;

/**
 * Server-Side Streaming RPC Handler: `StreamSyncProgress`
 */
async function streamSyncProgressHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: grpc.ServerWritableStream<any, any>
) {
  const maxBatch = call.request?.max_batch > 0 ? call.request.max_batch : 2;
  const pipeline = new IngestionPipeline();

  try {
    await pipeline.run(maxBatch, async (event) => {
      const framed = encodeSyncProgressFrame(event);
      call.write({
        step: framed.event.step,
        total_steps: framed.event.totalSteps,
        stage: framed.event.stage,
        stage_name: framed.event.stageName,
        message: framed.event.message,
        source_name: framed.event.sourceName ?? "",
        article_title: framed.event.articleTitle ?? "",
        assigned_category: framed.event.assignedCategory ?? "",
        fetched_count: framed.event.fetchedCount ?? 0,
        new_candidates: framed.event.newCandidates ?? 0,
        published_count: framed.event.publishedCount ?? 0,
        purged_count: framed.event.purgedCount ?? 0,
        elapsed_ms: framed.event.elapsedMs,
        protobuf_bytes: framed.protobufBytes,
        json_bytes: framed.jsonBytes,
      });
    });
    call.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.write({
      step: 5,
      total_steps: 5,
      stage: "STAGE_ERROR",
      stage_name: "STAGE_ERROR",
      message: `Error en pipeline gRPC: ${message}`,
      elapsed_ms: 0,
    });
    call.end();
  }
}

/**
 * Unary RPC Handler: `GetPipelineStatus`
 */
async function getPipelineStatusHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _call: grpc.ServerUnaryCall<any, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: grpc.sendUnaryData<any>
) {
  try {
    const grouped = await prisma.articleSummary.groupBy({
      by: ["category"],
      _count: { category: true },
    });

    const totalPublished = grouped.reduce(
      (acc, item) => acc + item._count.category,
      0
    );

    callback(null, {
      service_version: "1.0.0-grpc",
      protocol: "gRPC / Protocol Buffers v3 (HTTP/2)",
      total_published: totalPublished,
      max_retention_days: 30,
      max_capacity: 150,
      categories: grouped.map((g) => ({
        category: g.category,
        total_articles: g._count.category,
      })),
      timestamp_ms: Date.now(),
    });
  } catch (error) {
    callback({
      code: grpc.status.INTERNAL,
      message: error instanceof Error ? error.message : "Internal gRPC error",
    });
  }
}

export function startGrpcServer(port = 50051): grpc.Server {
  const server = new grpc.Server();
  server.addService(pulliaPackage.NewsPipelineService.service, {
    StreamSyncProgress: streamSyncProgressHandler,
    GetPipelineStatus: getPipelineStatusHandler,
  });

  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, boundPort) => {
      if (err) {
        console.error("[gRPC Server] Failed to bind:", err);
        return;
      }
      console.log(
        `⚡ [gRPC Server] NewsPipelineService listening on 0.0.0.0:${boundPort} (proto/pullia.proto)`
      );
    }
  );

  return server;
}

