import { startGrpcServer } from "../src/lib/grpc/server";

const PORT = Number(process.env.GRPC_PORT ?? 50051);
startGrpcServer(PORT);

