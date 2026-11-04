/**
 * PULL-IA / SoftStack • Deplhoy — Protocol Buffers v3 Schema & gRPC Wire Framing
 *
 * Uses `protobufjs` to compile `proto/pullia.proto` into binary Protocol Buffers
 * descriptors and frames messages using standard gRPC Length-Prefixed framing:
 *   [1-byte Compressed-Flag (0x00)] + [4-byte Big-Endian Message Length] + [Protobuf Binary Payload]
 */

import protobuf from "protobufjs";

export const PULLIA_PROTO_SDL = `syntax = "proto3";

package pullia.pipeline.v1;

service NewsPipelineService {
  rpc StreamSyncProgress (SyncRequest) returns (stream SyncProgressEvent);
  rpc GetPipelineStatus (StatusRequest) returns (PipelineStatusResponse);
}

enum SyncStage {
  STAGE_UNSPECIFIED = 0;
  STAGE_INIT = 1;
  STAGE_FETCHING = 2;
  STAGE_DEDUPLICATING = 3;
  STAGE_CLASSIFYING = 4;
  STAGE_RETENTION = 5;
  STAGE_COMPLETED = 6;
  STAGE_ERROR = 7;
}

message SyncRequest {
  int32 max_batch = 1;
  string triggered_by = 2;
}

message SyncProgressEvent {
  int32 step = 1;
  int32 total_steps = 2;
  SyncStage stage = 3;
  string stage_name = 4;
  string message = 5;
  string source_name = 6;
  string article_title = 7;
  string assigned_category = 8;
  int32 fetched_count = 9;
  int32 new_candidates = 10;
  int32 published_count = 11;
  int32 purged_count = 12;
  int64 elapsed_ms = 13;
  int32 protobuf_bytes = 14;
  int32 json_bytes = 15;
}

message StatusRequest {
  bool include_category_breakdown = 1;
}

message CategoryCount {
  string category = 1;
  int32 total_articles = 2;
}

message PipelineStatusResponse {
  string service_version = 1;
  string protocol = 2;
  int32 total_published = 3;
  int32 max_retention_days = 4;
  int32 max_capacity = 5;
  repeated CategoryCount categories = 6;
  int64 timestamp_ms = 7;
}
`;

export enum SyncStageEnum {
  STAGE_UNSPECIFIED = 0,
  STAGE_INIT = 1,
  STAGE_FETCHING = 2,
  STAGE_DEDUPLICATING = 3,
  STAGE_CLASSIFYING = 4,
  STAGE_RETENTION = 5,
  STAGE_COMPLETED = 6,
  STAGE_ERROR = 7,
}

export interface SyncProgressEventPayload {
  step: number;
  totalSteps: number;
  stage: SyncStageEnum;
  stageName: string;
  message: string;
  sourceName?: string;
  articleTitle?: string;
  assignedCategory?: string;
  fetchedCount?: number;
  newCandidates?: number;
  publishedCount?: number;
  purgedCount?: number;
  elapsedMs: number;
  protobufBytes?: number;
  jsonBytes?: number;
}

export interface SerializedGrpcStreamFrame {
  event: SyncProgressEventPayload;
  grpcMethod: string;
  protobufBytes: number;
  jsonBytes: number;
  savingsPercent: number;
  wireHexPreview: string;
  protobufBase64: string;
}

let cachedRoot: protobuf.Root | null = null;

function getProtoRoot(): protobuf.Root {
  if (!cachedRoot) {
    const parsed = protobuf.parse(PULLIA_PROTO_SDL, { keepCase: false });
    cachedRoot = parsed.root;
  }
  return cachedRoot;
}

/**
 * Encodes a `SyncProgressEventPayload` into a real binary Protocol Buffers message
 * wrapped in a 5-byte gRPC Length-Prefixed-Message wire frame.
 */
export function encodeSyncProgressFrame(
  payload: SyncProgressEventPayload
): SerializedGrpcStreamFrame {
  const root = getProtoRoot();
  const SyncProgressEventType = root.lookupType(
    "pullia.pipeline.v1.SyncProgressEvent"
  );

  // Measure raw JSON size first
  const jsonString = JSON.stringify(payload);
  const jsonBytes = Buffer.byteLength(jsonString, "utf-8");

  // First pass encode to measure binary Protobuf size
  const messageObj = {
    step: payload.step,
    totalSteps: payload.totalSteps,
    stage: payload.stage,
    stageName: payload.stageName,
    message: payload.message,
    sourceName: payload.sourceName ?? "",
    articleTitle: payload.articleTitle ?? "",
    assignedCategory: payload.assignedCategory ?? "",
    fetchedCount: payload.fetchedCount ?? 0,
    newCandidates: payload.newCandidates ?? 0,
    publishedCount: payload.publishedCount ?? 0,
    purgedCount: payload.purgedCount ?? 0,
    elapsedMs: payload.elapsedMs,
    protobufBytes: 0,
    jsonBytes,
  };

  const initialBin = SyncProgressEventType.encode(
    SyncProgressEventType.create(messageObj)
  ).finish();
  const protobufBytes = initialBin.length + 5; // +5 bytes for gRPC Length-Prefixed header

  // Final encode including the measured byte count
  messageObj.protobufBytes = protobufBytes;
  const finalBin = SyncProgressEventType.encode(
    SyncProgressEventType.create(messageObj)
  ).finish();

  // Build standard 5-byte gRPC Length-Prefixed-Message frame:
  // Byte 0: Compression flag (0x00 = uncompressed)
  // Bytes 1..4: UInt32BE message length
  const grpcHeader = Buffer.alloc(5);
  grpcHeader.writeUInt8(0, 0);
  grpcHeader.writeUInt32BE(finalBin.length, 1);
  const grpcWireFrame = Buffer.concat([grpcHeader, Buffer.from(finalBin)]);

  const hexBytes = Array.from(grpcWireFrame.subarray(0, 28))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

  const savingsPercent =
    jsonBytes > 0
      ? Math.max(0, Math.round(((jsonBytes - grpcWireFrame.length) / jsonBytes) * 100))
      : 0;

  return {
    event: {
      ...payload,
      protobufBytes: grpcWireFrame.length,
      jsonBytes,
    },
    grpcMethod: "/pullia.pipeline.v1.NewsPipelineService/StreamSyncProgress",
    protobufBytes: grpcWireFrame.length,
    jsonBytes,
    savingsPercent,
    wireHexPreview: `${hexBytes}${grpcWireFrame.length > 28 ? " …" : ""}`,
    protobufBase64: grpcWireFrame.toString("base64"),
  };
}

