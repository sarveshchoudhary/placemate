import os
import json
import time
import threading
from concurrent import futures

import grpc

import dfs_pb2
import dfs_pb2_grpc

from net_config import resolve


# ============================================================
# PlaceMate DFS Metadata Server
# ============================================================

PORT = 60501

# Each chunk will have 2 replicas
REPLICATION_FACTOR = 2

# Storage node considered DOWN if no heartbeat for 6 seconds
HEARTBEAT_TIMEOUT = 6

DATA_DIR = "dfs_data"
STATE_FILE = os.path.join(DATA_DIR, "metadata.json")


# ============================================================
# METADATA STATE
# ============================================================

class MetadataState:

    def __init__(self):

        os.makedirs(DATA_DIR, exist_ok=True)

        self.lock = threading.Lock()

        # Lamport logical clock
        self.lamport = 0

        # Three storage nodes
        self.nodes = {
            "dfs-store-1": {
                "address": resolve("dfs-store-1"),
                "alive": False,
                "last_heartbeat": 0
            },

            "dfs-store-2": {
                "address": resolve("dfs-store-2"),
                "alive": False,
                "last_heartbeat": 0
            },

            "dfs-store-3": {
                "address": resolve("dfs-store-3"),
                "alive": False,
                "last_heartbeat": 0
            }
        }

        # File metadata
        self.files = {}

        self.load_state()


    # ========================================================
    # LAMPORT CLOCK
    # ========================================================

    def tick(self):

        self.lamport += 1

        return self.lamport


    def receive(self, timestamp):

        self.lamport = max(
            self.lamport,
            timestamp
        ) + 1

        return self.lamport


    # ========================================================
    # SAVE METADATA
    # ========================================================

    def save_state(self):

        data = {
            "lamport": self.lamport,
            "nodes": self.nodes,
            "files": self.files
        }

        try:

            with open(
                STATE_FILE,
                "w"
            ) as f:

                json.dump(
                    data,
                    f,
                    indent=2
                )

        except Exception as error:

            print(
                "[Metadata] Failed to save state:",
                error
            )


    # ========================================================
    # LOAD METADATA
    # ========================================================

    def load_state(self):

        if not os.path.exists(
            STATE_FILE
        ):

            return

        try:

            with open(
                STATE_FILE,
                "r"
            ) as f:

                data = json.load(f)

            self.lamport = data.get(
                "lamport",
                0
            )

            saved_nodes = data.get(
                "nodes",
                {}
            )

            for node_id in self.nodes:

                if node_id in saved_nodes:

                    self.nodes[node_id].update(
                        saved_nodes[node_id]
                    )

            self.files = data.get(
                "files",
                {}
            )

        except Exception as error:

            print(
                "[Metadata] Failed to load state:",
                error
            )


    # ========================================================
    # NODE HEALTH MONITOR
    # ========================================================

    def update_node_status(self):

        changed = False

        # This function acquires the lock.
        # Therefore ClusterStatus() must NOT acquire
        # the lock before calling this function.

        with self.lock:

            current_time = time.time()

            for node_id, node in self.nodes.items():

                # Ignore nodes that have never sent heartbeat
                if node["last_heartbeat"] == 0:

                    continue

                alive = (
                    current_time -
                    node["last_heartbeat"]
                    <= HEARTBEAT_TIMEOUT
                )

                if node["alive"] != alive:

                    node["alive"] = alive

                    changed = True

                    if alive:

                        print(
                            f"[Metadata] "
                            f"{node_id} is BACK UP"
                        )

                    else:

                        print(
                            f"[Metadata] "
                            f"{node_id} is DOWN"
                        )

            if changed:

                self.save_state()


# ============================================================
# METADATA gRPC SERVICE
# ============================================================

class MetadataService(
    dfs_pb2_grpc.DfsMetadataServiceServicer
):

    def __init__(self, state):

        self.state = state


    # ========================================================
    # HEARTBEAT
    # ========================================================

    def Heartbeat(
        self,
        request,
        context
    ):

        with self.state.lock:

            self.state.receive(0)

            node_id = request.node_id

            if node_id not in self.state.nodes:

                self.state.nodes[node_id] = {
                    "address": request.address,
                    "alive": True,
                    "last_heartbeat": time.time()
                }

            else:

                self.state.nodes[
                    node_id
                ]["address"] = request.address

                self.state.nodes[
                    node_id
                ]["alive"] = True

                self.state.nodes[
                    node_id
                ]["last_heartbeat"] = time.time()

            self.state.save_state()

        print(
            f"[Metadata] Heartbeat from {node_id}"
        )

        return dfs_pb2.DfsAck(
            ok=True,
            message="Heartbeat received"
        )


    # ========================================================
    # ALLOCATE FILE
    # ========================================================

    def AllocateFile(
        self,
        request,
        context
    ):

        with self.state.lock:

            timestamp = self.state.receive(
                request.lamport_timestamp
            )

            old_version = 0

            if request.filename in self.state.files:

                old_version = self.state.files[
                    request.filename
                ].get(
                    "version",
                    0
                )

            version = old_version + 1

            # Find currently alive storage nodes
            live_nodes = [
                node_id
                for node_id, node in self.state.nodes.items()
                if node["alive"]
            ]

            print(
                f"[Metadata] Live nodes: "
                f"{live_nodes}"
            )

            # Need at least two nodes because
            # replication factor = 2
            if len(live_nodes) < REPLICATION_FACTOR:

                print(
                    "[Metadata] Not enough "
                    "live storage nodes"
                )

                return dfs_pb2.DfsAllocateReply(
                    ok=False,
                    message=(
                        "Not enough live storage nodes"
                    ),
                    version=version,
                    lamport_timestamp=timestamp
                )

            # Least-used storage nodes first
            live_nodes.sort(
                key=lambda node_id:
                self.chunk_count(node_id)
            )

            plans = []

            for index in range(
                request.num_chunks
            ):

                selected = []

                # Select two different nodes
                for node_id in live_nodes:

                    if node_id not in selected:

                        selected.append(
                            node_id
                        )

                    if len(selected) >= REPLICATION_FACTOR:

                        break

                chunk_id = (
                    f"{request.filename}"
                    f".v{version}"
                    f".c{index}"
                )

                addresses = [
                    self.state.nodes[node_id][
                        "address"
                    ]
                    for node_id in selected
                ]

                alive = [
                    self.state.nodes[node_id][
                        "alive"
                    ]
                    for node_id in selected
                ]

                plans.append(
                    dfs_pb2.DfsChunkPlan(
                        index=index,
                        chunk_id=chunk_id,
                        node_ids=selected,
                        addresses=addresses,
                        alive=alive,
                        sha256=""
                    )
                )

            # Save file metadata
            self.state.files[
                request.filename
            ] = {

                "version": version,

                "size": 0,

                "sha256": "",

                "chunks": [

                    {
                        "index": plan.index,

                        "chunk_id": plan.chunk_id,

                        "node_ids":
                            list(plan.node_ids),

                        "addresses":
                            list(plan.addresses),

                        "alive":
                            list(plan.alive),

                        "sha256":
                            ""
                    }

                    for plan in plans
                ]
            }

            self.state.save_state()

        print(
            f"[Metadata] Allocated "
            f"{request.filename} "
            f"version {version}"
        )

        return dfs_pb2.DfsAllocateReply(
            ok=True,
            message="File allocation successful",
            version=version,
            plan=plans,
            lamport_timestamp=timestamp
        )


    # ========================================================
    # COMMIT FILE
    # ========================================================

    def CommitFile(
        self,
        request,
        context
    ):

        with self.state.lock:

            timestamp = self.state.tick()

            if request.filename not in self.state.files:

                return dfs_pb2.DfsCommitReply(
                    ok=False,
                    message="File allocation not found",
                    lamport_timestamp=timestamp
                )

            file_info = self.state.files[
                request.filename
            ]

            file_info[
                "version"
            ] = request.version

            file_info[
                "size"
            ] = request.size

            file_info[
                "sha256"
            ] = request.sha256

            for chunk in request.chunks:

                for stored_chunk in file_info[
                    "chunks"
                ]:

                    if (
                        stored_chunk["chunk_id"]
                        ==
                        chunk.chunk_id
                    ):

                        stored_chunk[
                            "sha256"
                        ] = chunk.sha256

            self.state.save_state()

        print(
            f"[Metadata] Committed "
            f"{request.filename}"
        )

        return dfs_pb2.DfsCommitReply(
            ok=True,
            message="File committed successfully",
            lamport_timestamp=timestamp
        )


    # ========================================================
    # GET FILE INFORMATION
    # ========================================================

    def GetFileInfo(
        self,
        request,
        context
    ):

        with self.state.lock:

            file_info = self.state.files.get(
                request.filename
            )

            if not file_info:

                return dfs_pb2.DfsFileInfo(
                    found=False
                )

            chunks = []

            for chunk in file_info[
                "chunks"
            ]:

                alive = []

                for node_id in chunk[
                    "node_ids"
                ]:

                    node = self.state.nodes.get(
                        node_id
                    )

                    alive.append(
                        bool(
                            node and
                            node["alive"]
                        )
                    )

                chunks.append(
                    dfs_pb2.DfsChunkPlan(
                        index=chunk["index"],
                        chunk_id=chunk["chunk_id"],
                        node_ids=chunk["node_ids"],
                        addresses=chunk["addresses"],
                        alive=alive,
                        sha256=chunk["sha256"]
                    )
                )

            return dfs_pb2.DfsFileInfo(
                found=True,
                filename=request.filename,
                version=file_info["version"],
                size=file_info["size"],
                sha256=file_info["sha256"],
                chunks=chunks
            )


    # ========================================================
    # CLUSTER STATUS
    # ========================================================

    def ClusterStatus(
        self,
        request,
        context
    ):

        # IMPORTANT:
        #
        # update_node_status() itself acquires
        # self.state.lock.
        #
        # Therefore we MUST call it BEFORE acquiring
        # self.state.lock here.
        #
        # This fixes the deadlock that caused:
        #
        # python dfs_client.py status
        #
        # to hang indefinitely.

        self.state.update_node_status()

        with self.state.lock:

            nodes = []

            # ----------------------------------------------
            # Build storage-node status
            # ----------------------------------------------

            for node_id, node in self.state.nodes.items():

                nodes.append(
                    dfs_pb2.DfsNodeStatus(
                        node_id=node_id,
                        address=node["address"],
                        alive=node["alive"],
                        chunk_count=self.chunk_count(
                            node_id
                        )
                    )
                )

            files = []

            # ----------------------------------------------
            # Build file status
            # ----------------------------------------------

            for filename, file_info in (
                self.state.files.items()
            ):

                chunks = []

                for chunk in file_info[
                    "chunks"
                ]:

                    alive = []

                    for node_id in chunk[
                        "node_ids"
                    ]:

                        node = self.state.nodes.get(
                            node_id
                        )

                        alive.append(
                            bool(
                                node and
                                node["alive"]
                            )
                        )

                    chunks.append(
                        dfs_pb2.DfsChunkPlan(
                            index=chunk["index"],
                            chunk_id=chunk["chunk_id"],
                            node_ids=chunk["node_ids"],
                            addresses=chunk["addresses"],
                            alive=alive,
                            sha256=chunk["sha256"]
                        )
                    )

                files.append(
                    dfs_pb2.DfsFileInfo(
                        found=True,
                        filename=filename,
                        version=file_info[
                            "version"
                        ],
                        size=file_info[
                            "size"
                        ],
                        sha256=file_info[
                            "sha256"
                        ],
                        chunks=chunks
                    )
                )

            # ----------------------------------------------
            # Return complete cluster status
            # ----------------------------------------------

            return dfs_pb2.DfsStatusReply(
                nodes=nodes,
                files=files
            )


    # ========================================================
    # ADD REPLICA
    # ========================================================

    def AddReplica(
        self,
        request,
        context
    ):

        with self.state.lock:

            file_info = self.state.files.get(
                request.filename
            )

            if not file_info:

                return dfs_pb2.DfsAck(
                    ok=False,
                    message="File not found"
                )

            for chunk in file_info[
                "chunks"
            ]:

                if (
                    chunk["index"]
                    ==
                    request.chunk_index
                ):

                    if (
                        request.node_id
                        not in chunk["node_ids"]
                    ):

                        if (
                            request.node_id
                            not in self.state.nodes
                        ):

                            return dfs_pb2.DfsAck(
                                ok=False,
                                message=(
                                    "Storage node "
                                    "not registered"
                                )
                            )

                        chunk[
                            "node_ids"
                        ].append(
                            request.node_id
                        )

                        chunk[
                            "addresses"
                        ].append(
                            self.state.nodes[
                                request.node_id
                            ]["address"]
                        )

                        chunk[
                            "alive"
                        ].append(True)

            self.state.save_state()

        return dfs_pb2.DfsAck(
            ok=True,
            message="Replica added"
        )


    # ========================================================
    # COUNT CHUNKS ON NODE
    # ========================================================

    def chunk_count(
        self,
        node_id
    ):

        count = 0

        for file_info in (
            self.state.files.values()
        ):

            for chunk in file_info[
                "chunks"
            ]:

                if (
                    node_id
                    in chunk["node_ids"]
                ):

                    count += 1

        return count


# ============================================================
# HEALTH MONITOR THREAD
# ============================================================

def health_monitor(state):

    while True:

        time.sleep(2)

        state.update_node_status()


# ============================================================
# START METADATA SERVER
# ============================================================

def serve():

    state = MetadataState()

    server = grpc.server(
        futures.ThreadPoolExecutor(
            max_workers=10
        )
    )

    dfs_pb2_grpc.add_DfsMetadataServiceServicer_to_server(
        MetadataService(state),
        server
    )

    server.add_insecure_port(
        f"0.0.0.0:{PORT}"
    )

    server.start()

    print("=" * 60)

    print(
        "PlaceMate DFS Metadata Server "
        f"running on port {PORT}"
    )

    print(
        "Replication factor:",
        REPLICATION_FACTOR
    )

    print(
        "Heartbeat timeout:",
        HEARTBEAT_TIMEOUT,
        "seconds"
    )

    print("=" * 60)

    # Start health-monitor thread
    monitor = threading.Thread(
        target=health_monitor,
        args=(state,),
        daemon=True
    )

    monitor.start()

    try:

        while True:

            time.sleep(86400)

    except KeyboardInterrupt:

        print(
            "\nMetadata server stopped."
        )

        server.stop(0)


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    serve()