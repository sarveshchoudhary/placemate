import os
import sys
import time
import hashlib
import threading
from concurrent import futures

import grpc

import dfs_pb2
import dfs_pb2_grpc

from net_config import resolve


# ============================================================
# PlaceMate Distributed File System - Storage Node
# ============================================================

if len(sys.argv) != 2:
    print("Usage: python dfs_storage.py <node_number>")
    print("Example: python dfs_storage.py 1")
    sys.exit(1)


NODE_NUMBER = sys.argv[1]

if NODE_NUMBER not in ["1", "2", "3"]:
    print("Node number must be 1, 2, or 3")
    sys.exit(1)


NODE_ID = f"dfs-store-{NODE_NUMBER}"

PORTS = {
    "1": 60511,
    "2": 60512,
    "3": 60513
}

PORT = PORTS[NODE_NUMBER]

NODE_ADDRESS = resolve(NODE_ID)

STORAGE_DIR = os.path.join(
    "dfs_data",
    f"store-{NODE_NUMBER}"
)

os.makedirs(STORAGE_DIR, exist_ok=True)


# ============================================================
# SHA-256 CHECKSUM
# ============================================================

def calculate_sha256(data):

    return hashlib.sha256(data).hexdigest()


# ============================================================
# STORAGE SERVICE
# ============================================================

class StorageService(
    dfs_pb2_grpc.DfsStorageServiceServicer
):

    # --------------------------------------------------------
    # PUT CHUNK
    # --------------------------------------------------------

    def PutChunk(self, request, context):

        data = request.data

        calculated_hash = calculate_sha256(data)

        # Verify checksum before storing
        if request.sha256:

            if calculated_hash != request.sha256:

                print(
                    f"[{NODE_ID}] CHECKSUM ERROR "
                    f"for {request.chunk_id}"
                )

                return dfs_pb2.DfsAck(
                    ok=False,
                    message="Checksum mismatch"
                )

        path = os.path.join(
            STORAGE_DIR,
            request.chunk_id
        )

        try:

            with open(path, "wb") as file:
                file.write(data)

            print(
                f"[{NODE_ID}] STORED "
                f"{request.chunk_id} "
                f"({len(data)} bytes)"
            )

            return dfs_pb2.DfsAck(
                ok=True,
                message=f"Chunk stored on {NODE_ID}"
            )

        except Exception as error:

            print(
                f"[{NODE_ID}] Storage error:",
                error
            )

            return dfs_pb2.DfsAck(
                ok=False,
                message=str(error)
            )

    # --------------------------------------------------------
    # GET CHUNK
    # --------------------------------------------------------

    def GetChunk(self, request, context):

        path = os.path.join(
            STORAGE_DIR,
            request.chunk_id
        )

        if not os.path.exists(path):

            print(
                f"[{NODE_ID}] CHUNK NOT FOUND: "
                f"{request.chunk_id}"
            )

            context.set_code(
                grpc.StatusCode.NOT_FOUND
            )

            context.set_details(
                "Chunk not found"
            )

            return dfs_pb2.DfsChunkData()

        try:

            with open(path, "rb") as file:
                data = file.read()

            checksum = calculate_sha256(data)

            print(
                f"[{NODE_ID}] READ "
                f"{request.chunk_id} "
                f"({len(data)} bytes)"
            )

            return dfs_pb2.DfsChunkData(
                chunk_id=request.chunk_id,
                data=data,
                sha256=checksum
            )

        except Exception as error:

            context.set_code(
                grpc.StatusCode.INTERNAL
            )

            context.set_details(
                str(error)
            )

            return dfs_pb2.DfsChunkData()


# ============================================================
# HEARTBEAT
# ============================================================

def heartbeat_loop():

    metadata_address = resolve("dfs-meta")

    while True:

        try:

            channel = grpc.insecure_channel(
                metadata_address
            )

            client = (
                dfs_pb2_grpc
                .DfsMetadataServiceStub(channel)
            )

            response = client.Heartbeat(
                dfs_pb2.DfsNodeInfo(
                    node_id=NODE_ID,
                    address=NODE_ADDRESS
                ),
                timeout=2
            )

            if response.ok:

                print(
                    f"[{NODE_ID}] Heartbeat -> Metadata"
                )

        except grpc.RpcError:

            print(
                f"[{NODE_ID}] Metadata unavailable"
            )

        except Exception as error:

            print(
                f"[{NODE_ID}] Heartbeat error:",
                error
            )

        time.sleep(2)


# ============================================================
# START STORAGE SERVER
# ============================================================

def serve():

    server = grpc.server(
        futures.ThreadPoolExecutor(
            max_workers=10
        )
    )

    dfs_pb2_grpc.add_DfsStorageServiceServicer_to_server(
        StorageService(),
        server
    )

    server.add_insecure_port(
        f"0.0.0.0:{PORT}"
    )

    server.start()

    print("=" * 55)
    print("PlaceMate Distributed Storage Node")
    print(f"Node ID     : {NODE_ID}")
    print(f"Port        : {PORT}")
    print(f"Storage Dir : {STORAGE_DIR}")
    print("=" * 55)

    heartbeat_thread = threading.Thread(
        target=heartbeat_loop,
        daemon=True
    )

    heartbeat_thread.start()

    try:

        while True:
            time.sleep(86400)

    except KeyboardInterrupt:

        print(
            f"\n[{NODE_ID}] Storage node stopped"
        )

        server.stop(0)


if __name__ == "__main__":
    serve()