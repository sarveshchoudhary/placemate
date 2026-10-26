const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync(
    __dirname + "/replica.proto",
    {
        keepCase: true
    }
);

const replicaProto =
    grpc.loadPackageDefinition(packageDefinition).eventual_demo;

const REPLICAS = {
    A: "localhost:60301",
    B: "localhost:60302",
    C: "localhost:60303"
};

class ReplicaNode {

    constructor(name) {
        this.name = name;
        this.clock = 0;
        this.store = {};
    }

    tick() {
        this.clock++;
        return this.clock;
    }

    updateClock(receivedTimestamp) {
        this.clock =
            Math.max(this.clock, receivedTimestamp) + 1;

        return this.clock;
    }

    applyIfNewer(key, content, timestamp, origin) {

        const current = this.store[key];

        if (
            !current ||
            timestamp > current.timestamp ||
            (
                timestamp === current.timestamp &&
                origin > current.origin
            )
        ) {

            this.store[key] = {
                content: content,
                timestamp: timestamp,
                origin: origin
            };

            console.log(
                `[Replica-${this.name}] APPLIED ${key} = "${content}" ` +
                `(timestamp=${timestamp}, origin=${origin})`
            );

            return true;
        }

        console.log(
            `[Replica-${this.name}] IGNORED stale update for ${key}`
        );

        return false;
    }

    gossip(key, content, timestamp, origin) {

        for (const [peer, address] of Object.entries(REPLICAS)) {

            if (peer === this.name) {
                continue;
            }

            setTimeout(() => {

               
                const client =
                    new replicaProto.ReplicaService(
                        address,
                        grpc.credentials.createInsecure()
                    );

                client.SyncUpdate(
                    {
                        key: key,
                        content: content,
                        lamport_timestamp: timestamp,
                        origin_replica: origin
                    },
                    (err, response) => {

                        if (err) {

                            console.log(
                                `[Replica-${this.name}] Gossip to ` +
                                `Replica-${peer} failed`
                            );

                        } else {

                            console.log(
                                `[Replica-${this.name}] Gossiped ` +
                                `${key} -> Replica-${peer}`
                            );
                        }

                    }
                );

            }, 500);
        }
    }

    SaveValue(call, callback) {

        const request = call.request;

        const timestamp = this.tick();

        console.log(
            `\n[Replica-${this.name}] Local booking received`
        );

        console.log(
            `[Replica-${this.name}] Classroom: ${request.key}`
        );

        console.log(
            `[Replica-${this.name}] Booking: ${request.content}`
        );

        console.log(
            `[Replica-${this.name}] Lamport timestamp: ${timestamp}`
        );

        // Apply local write FIRST
        this.applyIfNewer(
            request.key,
            request.content,
            timestamp,
            this.name
        );

        // Send response immediately
        callback(null, {
            accepted: true,
            replica: this.name,
            lamport_timestamp: timestamp
        });

        // Gossip happens asynchronously
        this.gossip(
            request.key,
            request.content,
            timestamp,
            this.name
        );
    }

    SyncUpdate(call, callback) {

        const request = call.request;

        this.updateClock(
            request.lamport_timestamp
        );

        console.log(
            `[Replica-${this.name}] Received gossip from ` +
            `${request.origin_replica}`
        );

        this.applyIfNewer(
            request.key,
            request.content,
            request.lamport_timestamp,
            request.origin_replica
        );

        callback(null, {
            accepted: true,
            replica: this.name,
            lamport_timestamp: this.clock
        });
    }

    GetValue(call, callback) {

        const key = call.request.key;

        const current = this.store[key];

        if (!current) {

            callback(null, {
                key: key,
                content: "",
                lamport_timestamp: 0,
                origin_replica: ""
            });

            return;
        }

        callback(null, {
            key: key,
            content: current.content,
            lamport_timestamp: current.timestamp,
            origin_replica: current.origin
        });
    }
}

function startServer(name, port) {

    const server = new grpc.Server();

    const node = new ReplicaNode(name);

    server.addService(
        replicaProto.ReplicaService.service,
        {
            SaveValue: node.SaveValue.bind(node),
            SyncUpdate: node.SyncUpdate.bind(node),
            GetValue: node.GetValue.bind(node)
        }
    );

    server.bindAsync(
        `localhost:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (error) => {

            if (error) {

                console.error(error);
                return;
            }

            console.log(
                `Replica-${name} listening on port ${port}`
            );
        }
    );
}

const name = process.argv[2];
const port = Number(process.argv[3]);

startServer(name, port);