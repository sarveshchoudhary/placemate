const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync(
    __dirname + "/loadbalance.proto"
);

const loadbalanceProto =
    grpc.loadPackageDefinition(packageDefinition).loadbalance;

// Three backend servers
const BACKENDS = [
    "localhost:60201",
    "localhost:60202",
    "localhost:60203"
];

// Number of requests
const NUM_REQUESTS = 9;

// Active connections for each server
const active = [0, 0, 0];

// Used to safely update active counts
let lock = false;

function acquireLock(callback) {

    const tryLock = () => {

        if (!lock) {
            lock = true;
            callback();
        } else {
            setTimeout(tryLock, 1);
        }

    };

    tryLock();
}

function releaseLock() {
    lock = false;
}

// Least Connections algorithm
function pickLeastConnections(callback) {

    acquireLock(() => {

        let index = 0;

        for (let i = 1; i < active.length; i++) {

            if (active[i] < active[index]) {
                index = i;
            }

        }

        // Increase BEFORE sending request
        active[index]++;

        console.log(
            `[LB] Routing -> ${BACKENDS[index]}`
        );

        console.log(
            `[LB] Active connections: ${active}`
        );

        releaseLock();

        callback(index);
    });
}

function releaseConnection(index) {

    acquireLock(() => {

        active[index]--;

        console.log(
            `[LB] Released ${BACKENDS[index]}`
        );

        console.log(
            `[LB] Active connections: ${active}`
        );

        releaseLock();
    });
}

function handleRequest(requestId) {

    pickLeastConnections((index) => {

        const address = BACKENDS[index];

        const client = new loadbalanceProto.WorkerService(
            address,
            grpc.credentials.createInsecure()
        );

        client.HandleRequest(
            {
                requestId: requestId
            },
            (err, response) => {

                if (err) {

                    console.log(
                        `[LB] Request ${requestId} failed:`,
                        err.message
                    );

                } else {

                    console.log(
                        `[LB] Request ${requestId} handled by ${response.handledBy}`
                    );

                }

                releaseConnection(index);
            }
        );

    });
}

console.log(
    `[LB] Load Balancer started`
);

console.log(
    `[LB] Backends: ${BACKENDS.join(", ")}`
);

for (let requestId = 1; requestId <= NUM_REQUESTS; requestId++) {

    handleRequest(requestId);

    // Small delay between requests
    setTimeout(() => {}, 150);
}