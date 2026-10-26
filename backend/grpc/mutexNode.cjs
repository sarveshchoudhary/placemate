const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync(
    __dirname + "/../proto/booking.proto",
    {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
    }
);

const bookingProto =
    grpc.loadPackageDefinition(packageDefinition).booking;


// Three PlaceMate distributed nodes
const PEERS = {
    1: "localhost:60051",
    2: "localhost:60052",
    3: "localhost:60053"
};


class MutexNode {

    constructor(nodeId) {

        this.id = nodeId;

        this.clock = 0;

        this.state = "RELEASED";

        this.requestTime = null;

        this.deferredRequests = [];
    }


    // Increase Lamport Clock
    tick() {

        this.clock += 1;

        return this.clock;
    }


    // Update Lamport Clock
    update(receivedTimestamp) {

        this.clock =
            Math.max(this.clock, receivedTimestamp) + 1;

        return this.clock;
    }


    // Receive request from another node
    RequestAccess(call, callback) {

        const request = call.request;

        console.log(
            `Node-${this.id} received request from Node-${request.nodeId}`
        );

        console.log(
            `Received Timestamp: ${request.timestamp}`
        );


        this.update(request.timestamp);


        let defer = false;


        // Defer request if this node is currently
        // using the critical section
        if (this.state === "HELD") {

            defer = true;

        }

        // If both nodes want access,
        // node with smaller timestamp gets priority
        else if (
            this.state === "WANTED" &&
            (
                this.requestTime < request.timestamp ||

                (
                    this.requestTime === request.timestamp &&
                    this.id < request.nodeId
                )
            )
        ) {

            defer = true;
        }


        if (defer) {

            console.log(
                `Node-${this.id} DEFERS Node-${request.nodeId}`
            );

            this.deferredRequests.push({
                callback,
                nodeId: request.nodeId
            });

        } else {

            console.log(
                `Node-${this.id} GRANTS access to Node-${request.nodeId}`
            );

            const timestamp = this.tick();

            callback(null, {
                nodeId: this.id,
                timestamp: timestamp
            });
        }
    }


    // Request critical section
    async requestAccess() {

        const timestamp = this.tick();

        this.state = "WANTED";

        this.requestTime = timestamp;


        console.log(
            `\nNode-${this.id} WANTS to book the classroom`
        );

        console.log(
            `Request Timestamp: ${timestamp}`
        );


        const peers = Object.entries(PEERS)
            .filter(([peerId]) => Number(peerId) !== this.id);


        try {

            for (const [peerId, address] of peers) {

                await new Promise((resolve, reject) => {

                    const client =
                        new bookingProto.MutexService(
                            address,
                            grpc.credentials.createInsecure()
                        );

                    client.RequestAccess(
                        {
                            nodeId: this.id,
                            timestamp: timestamp
                        },

                        (err, response) => {

                            if (err) {

                                reject(err);

                                return;
                            }


                            this.update(response.timestamp);

                            console.log(
                                `Node-${this.id} received GRANT from Node-${peerId}`
                            );

                            resolve();
                        }
                    );
                });
            }


            // All permissions received
            this.state = "HELD";


            console.log(
                `\nNode-${this.id} ENTERED CRITICAL SECTION`
            );

            console.log(
                `Node-${this.id} is booking Lab-101...`
            );


            // Simulate booking process
            await new Promise(
                resolve => setTimeout(resolve, 3000)
            );


            this.releaseAccess();


        } catch (error) {

            console.log(
                `Node-${this.id} Error:`,
                error.message
            );
        }
    }


    // Release critical section
    releaseAccess() {

        console.log(
            `Node-${this.id} RELEASED CRITICAL SECTION`
        );


        this.state = "RELEASED";


        // Reply to deferred nodes
        while (this.deferredRequests.length > 0) {

            const deferred =
                this.deferredRequests.shift();


            const timestamp = this.tick();


            console.log(
                `Node-${this.id} now GRANTS access to Node-${deferred.nodeId}`
            );


            deferred.callback(null, {
                nodeId: this.id,
                timestamp: timestamp
            });
        }
    }


    startServer() {

        const server = new grpc.Server();


        server.addService(
            bookingProto.MutexService.service,
            {
                RequestAccess:
                    this.RequestAccess.bind(this)
            }
        );


        const address = PEERS[this.id];


        server.bindAsync(
            address,

            grpc.ServerCredentials.createInsecure(),

            (error, port) => {

                if (error) {

                    console.error(error);

                    return;
                }


                console.log(
                    `Node-${this.id} running on port ${port}`
                );
            }
        );


        return server;
    }
}


// Get Node ID from terminal
const nodeId =
    parseInt(process.argv[2]);


if (!nodeId || !PEERS[nodeId]) {

    console.log(
        "Usage: node grpc/mutexNode.cjs 1"
    );

    process.exit();
}


const node =
    new MutexNode(nodeId);


node.startServer();


setTimeout(() => {
    node.requestAccess();
}, 20000);