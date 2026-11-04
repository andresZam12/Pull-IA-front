import { NextRequest, NextResponse } from "next/server";
import { IngestionPipeline } from "@/lib/pipeline/ingest";
import {
  encodeSyncProgressFrame,
  PULLIA_PROTO_SDL,
  SyncStageEnum,
} from "@/lib/grpc/proto-schema";
import prisma from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/grpc/sync-stream
 * Unary RPC equivalent (`GetPipelineStatus`) + `.proto` IDL inspection.
 */
export async function GET() {
  try {
    const grouped = await prisma.articleSummary.groupBy({
      by: ["category"],
      _count: { category: true },
    });

    const totalPublished = grouped.reduce(
      (acc, item) => acc + item._count.category,
      0
    );

    return NextResponse.json(
      {
        service: "pullia.pipeline.v1.NewsPipelineService",
        rpcs: [
          "rpc StreamSyncProgress (SyncRequest) returns (stream SyncProgressEvent)",
          "rpc GetPipelineStatus (StatusRequest) returns (PipelineStatusResponse)",
        ],
        protocol: "gRPC / Protocol Buffers v3",
        status: {
          serviceVersion: "1.0.0-grpc",
          totalPublished,
          maxRetentionDays: 30,
          maxCapacity: 150,
          categories: grouped.map((g) => ({
            category: g.category,
            totalArticles: g._count.category,
          })),
        },
        protoSchema: PULLIA_PROTO_SDL,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Error inspecting gRPC service",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /api/grpc/sync-stream
 * Executes `NewsPipelineService.StreamSyncProgress` (Server-Side Streaming RPC).
 * Each pipeline milestone is serialized into binary Protocol Buffers (with a 5-byte
 * gRPC Length-Prefixed wire header) and streamed in real time to the client.
 */
export async function POST(_request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const pipeline = new IngestionPipeline();
      let totalProtobufBytes = 0;
      let totalJsonBytes = 0;

      const sendFrame = (payload: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
      };

      try {
        const result = await pipeline.run(2, async (event) => {
          const grpcFrame = encodeSyncProgressFrame(event);
          totalProtobufBytes += grpcFrame.protobufBytes;
          totalJsonBytes += grpcFrame.jsonBytes;

          sendFrame({
            type: "GRPC_STREAM_FRAME",
            frame: grpcFrame,
          });
        });

        const totalSavingsPercent =
          totalJsonBytes > 0
            ? Math.max(
                0,
                Math.round(
                  ((totalJsonBytes - totalProtobufBytes) / totalJsonBytes) * 100
                )
              )
            : 0;

        sendFrame({
          type: "GRPC_STREAM_SUMMARY",
          success: true,
          newCount: result.published,
          fetchedCount: result.fetched,
          deduplicatedCount: result.deduplicated,
          durationMs: result.duration,
          totalProtobufBytes,
          totalJsonBytes,
          totalSavingsPercent,
          protoSchema: PULLIA_PROTO_SDL,
          message:
            result.published > 0
              ? `Stream gRPC completado: Se encontraron y publicaron ${result.published} noticias nuevas en español.`
              : `Stream gRPC completado: Todo al día (${result.fetched} artículos verificados en las fuentes oficiales).`,
        });
      } catch (error) {
        const errMessage =
          error instanceof Error ? error.message : "Error en stream gRPC";
        const errFrame = encodeSyncProgressFrame({
          step: 5,
          totalSteps: 5,
          stage: SyncStageEnum.STAGE_ERROR,
          stageName: "STAGE_ERROR",
          message: `Error en NewsPipelineService.StreamSyncProgress: ${errMessage}`,
          elapsedMs: 0,
        });

        sendFrame({
          type: "GRPC_STREAM_FRAME",
          frame: errFrame,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Grpc-Service": "pullia.pipeline.v1.NewsPipelineService",
      "X-Grpc-Method": "StreamSyncProgress",
    },
  });
}

