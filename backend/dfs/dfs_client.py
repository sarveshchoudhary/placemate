import sys
import os
import hashlib
import grpc

import dfs_pb2
import dfs_pb2_grpc

from net_config import resolve


META = resolve("dfs-meta")

CHUNK_SIZE = 512


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def metadata_client():
    channel = grpc.insecure_channel(META)
    return dfs_pb2_grpc.DfsMetadataServiceStub(channel)


def storage_client(address):
    channel = grpc.insecure_channel(address)
    return dfs_pb2_grpc.DfsStorageServiceStub(channel)


def put_file(filename):

    if not os.path.exists(filename):
        print("File not found:", filename)
        return

    with open(filename, "rb") as f:
        data = f.read()

    chunks = []

    for i in range(0, len(data), CHUNK_SIZE):
        chunks.append(data[i:i + CHUNK_SIZE])

    print()
    print("========================================")
    print("PlaceMate DFS PUT")
    print("File:", filename)
    print("Size:", len(data), "bytes")
    print("Chunks:", len(chunks))
    print("========================================")

    meta = metadata_client()

    allocation = meta.AllocateFile(
        dfs_pb2.DfsAllocateRequest(
            filename=os.path.basename(filename),
            num_chunks=len(chunks),
            lamport_timestamp=0
        )
    )

    if not allocation.ok:
        print("Allocation failed:")
        print(allocation.message)
        return

    print(
        f"Allocated version {allocation.version}"
    )

    stored_plans = []

    for i, chunk_data in enumerate(chunks):

        plan = allocation.plan[i]

        checksum = sha256(chunk_data)

        print()
        print(
            f"Chunk {i}: {plan.chunk_id}"
        )

        print(
            "Checksum:",
            checksum
        )

        successful_nodes = []

        for j, address in enumerate(plan.addresses):

            node_id = plan.node_ids[j]

            try:

                client = storage_client(address)

                response = client.PutChunk(
                    dfs_pb2.DfsChunkData(
                        chunk_id=plan.chunk_id,
                        data=chunk_data,
                        sha256=checksum
                    ),
                    timeout=3
                )

                if response.ok:

                    print(
                        f"  Stored on {node_id}"
                    )

                    successful_nodes.append(
                        node_id
                    )

                else:

                    print(
                        f"  Failed on {node_id}: "
                        f"{response.message}"
                    )

            except grpc.RpcError as error:

                print(
                    f"  {node_id} unavailable"
                )

        stored_plans.append(
            dfs_pb2.DfsChunkPlan(
                index=plan.index,
                chunk_id=plan.chunk_id,
                node_ids=plan.node_ids,
                addresses=plan.addresses,
                alive=plan.alive,
                sha256=checksum
            )
        )

    file_checksum = sha256(data)

    commit = meta.CommitFile(
        dfs_pb2.DfsCommitRequest(
            filename=os.path.basename(filename),
            version=allocation.version,
            size=len(data),
            sha256=file_checksum,
            chunks=stored_plans
        )
    )

    print()

    if commit.ok:

        print(
            "SUCCESS:",
            commit.message
        )

        print(
            "File checksum:",
            file_checksum
        )

    else:

        print(
            "COMMIT FAILED:",
            commit.message
        )


def get_file(filename, output):

    meta = metadata_client()

    info = meta.GetFileInfo(
        dfs_pb2.DfsFileQuery(
            filename=os.path.basename(filename)
        )
    )

    if not info.found:

        print("File not found in DFS")
        return

    print()
    print("========================================")
    print("PlaceMate DFS GET")
    print("File:", filename)
    print("Version:", info.version)
    print("========================================")

    result = bytearray()

    for chunk in info.chunks:

        found = False

        for j, address in enumerate(chunk.addresses):

            node_id = chunk.node_ids[j]

            try:

                client = storage_client(address)

                response = client.GetChunk(
                    dfs_pb2.DfsChunkId(
                        chunk_id=chunk.chunk_id
                    ),
                    timeout=3
                )

                received_hash = sha256(
                    response.data
                )

                if received_hash != chunk.sha256:

                    print(
                        f"  {node_id}: "
                        f"CHECKSUM MISMATCH"
                    )

                    continue

                print(
                    f"  {node_id}: "
                    f"valid replica"
                )

                result.extend(response.data)

                found = True
                break

            except grpc.RpcError:

                print(
                    f"  {node_id}: unavailable"
                )

        if not found:

            print(
                "ERROR: No valid replica for",
                chunk.chunk_id
            )

            return

    with open(output, "wb") as f:
        f.write(result)

    final_hash = sha256(result)

    print()
    print("Output:", output)
    print("SHA-256:", final_hash)

    if final_hash == info.sha256:

        print("SUCCESS: File checksum verified")

    else:

        print("ERROR: File checksum mismatch")


def status():

    meta = metadata_client()

    result = meta.ClusterStatus(
        dfs_pb2.DfsStatusRequest()
    )

    print()
    print("========================================")
    print("PlaceMate DFS CLUSTER STATUS")
    print("========================================")

    print()
    print("Storage Nodes:")

    for node in result.nodes:

        state = "UP" if node.alive else "DOWN"

        print(
            f"{node.node_id:15} "
            f"{state:5} "
            f"chunks={node.chunk_count}"
        )

    print()
    print("Files:")

    if not result.files:

        print("  No files")

    for file in result.files:

        print(
            f"  {file.filename} "
            f"(version {file.version}, "
            f"{len(file.chunks)} chunks)"
        )

        for chunk in file.chunks:

            replicas = ", ".join(
                chunk.node_ids
            )

            print(
                f"    Chunk {chunk.index}: "
                f"{replicas}"
            )


def main():

    if len(sys.argv) < 2:

        print()
        print("Usage:")
        print("  python dfs_client.py status")
        print("  python dfs_client.py put <file>")
        print("  python dfs_client.py get <file> <output>")
        return

    command = sys.argv[1]

    if command == "status":

        status()

    elif command == "put":

        if len(sys.argv) != 3:

            print(
                "Usage: "
                "python dfs_client.py put <file>"
            )

            return

        put_file(sys.argv[2])

    elif command == "get":

        if len(sys.argv) != 4:

            print(
                "Usage: "
                "python dfs_client.py get "
                "<file> <output>"
            )

            return

        get_file(
            sys.argv[2],
            sys.argv[3]
        )

    else:

        print("Unknown command")


if __name__ == "__main__":
    main()