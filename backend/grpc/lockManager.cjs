const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync(
    __dirname + "/../proto/booking.proto"
);

const bookingProto =
    grpc.loadPackageDefinition(packageDefinition).booking;

// Detection mode
const DETECT = process.argv[2] === "detect";

// Lock Manager
class LockManager {

    constructor() {

        this.locks = {
            draft: null,
            submission: null
        };

        // Which resource each node is waiting for
        this.waitFor = {};

        console.log(
            `Lock Manager started on port 60100`
        );

        console.log(
            `Deadlock detection = ${DETECT}`
        );
    }


    // Check whether granting this request creates a cycle
    wouldCreateCycle(holder, resource) {

        const visited = new Set();

        let currentResource = resource;

        while (true) {

            const owner =
                this.locks[currentResource];

            if (owner === null ||
                owner === undefined) {

                return false;
            }

            if (owner === holder) {

                return true;
            }

            if (visited.has(owner)) {

                return false;
            }

            visited.add(owner);

            currentResource =
                this.waitFor[owner];

            if (!currentResource) {

                return false;
            }
        }
    }


    acquireLock(call, callback) {

        const resource =
            call.request.resourceId;

        const holder =
            call.request.holderId;

        const timestamp =
            call.request.timestamp;


        console.log(
            `\nLock Request: Node-${holder} wants '${resource}'`
        );

        console.log(
            `Timestamp: ${timestamp}`
        );


        // Resource is free
        if (this.locks[resource] === null) {

            this.locks[resource] = holder;

            console.log(
                `GRANTED: Node-${holder} -> '${resource}'`
            );

            callback(null, {
                granted: true,
                message: "Lock granted"
            });

            return;
        }


        const owner =
            this.locks[resource];


        // Deadlock detection
        if (
            DETECT &&
            this.wouldCreateCycle(holder, resource)
        ) {

            console.log(
                `\n*** DEADLOCK DETECTED ***`
            );

            console.log(
                `Node-${holder} request would create a cycle`
            );

            console.log(
                `Aborting Node-${holder}`
            );


            callback(null, {
                granted: false,
                message: "deadlock-abort"
            });

            return;
        }


        // Resource is busy
        this.waitFor[holder] = resource;

        console.log(
            `Node-${holder} WAITING for '${resource}'`
        );

        console.log(
            `'${resource}' is held by Node-${owner}`
        );


        // Wait until resource becomes free
        const checkLock = () => {

            if (this.locks[resource] === null) {

                this.locks[resource] = holder;

                delete this.waitFor[holder];

                console.log(
                    `GRANTED AFTER WAIT: Node-${holder} -> '${resource}'`
                );

                callback(null, {
                    granted: true,
                    message: "Lock granted after waiting"
                });

                return;
            }

            setTimeout(checkLock, 500);
        };


        checkLock();
    }


    releaseLock(call, callback) {

        const resource =
            call.request.resourceId;

        const holder =
            call.request.holderId;


        if (this.locks[resource] === holder) {

            this.locks[resource] = null;

            console.log(
                `Node-${holder} RELEASED '${resource}'`
            );
        }


        callback(null, {
            granted: true,
            message: "Lock released"
        });
    }
}


const manager =
    new LockManager();


const server =
    new grpc.Server();


server.addService(
    bookingProto.LockService.service,
    {
        AcquireLock:
            manager.acquireLock.bind(manager),

        ReleaseLock:
            manager.releaseLock.bind(manager)
    }
);


server.bindAsync(
    "0.0.0.0:60100",

    grpc.ServerCredentials.createInsecure(),

    (err, port) => {

        if (err) {

            console.error(err);

            return;
        }

        console.log(
            `Lock Manager running on port ${port}`
        );
    }
);