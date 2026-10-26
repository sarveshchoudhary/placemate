const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync(
    __dirname + "/../proto/booking.proto"
);

const bookingProto =
    grpc.loadPackageDefinition(packageDefinition).booking;


// Node ID and role from command line
const nodeId = parseInt(process.argv[2]);
const role = process.argv[3];

if (!nodeId || !role) {
    console.log(
        "Usage: node grpc/deadlockWorker.cjs <nodeId> <autosave|submit>"
    );
    process.exit();
}


// Connect to Lock Manager
const client = new bookingProto.LockService(
    "localhost:60100",
    grpc.credentials.createInsecure()
);


let timestamp = nodeId;


// Acquire a lock
function acquire(resource) {

    timestamp++;

    return new Promise((resolve, reject) => {

        client.AcquireLock(
            {
                resourceId: resource,
                holderId: nodeId,
                timestamp: timestamp
            },

            (err, response) => {

                if (err) {
                    reject(err);
                    return;
                }

                console.log(
                    `Node-${nodeId}: '${resource}' -> ${response.granted} (${response.message})`
                );

                resolve(response.granted);
            }
        );
    });
}


// Release a lock
function release(resource) {

    return new Promise((resolve, reject) => {

        client.ReleaseLock(
            {
                resourceId: resource,
                holderId: nodeId,
                timestamp: timestamp
            },

            (err, response) => {

                if (err) {
                    reject(err);
                    return;
                }

                console.log(
                    `Node-${nodeId}: Released '${resource}'`
                );

                resolve(response);
            }
        );
    });
}


// Main worker
async function run() {

    let first;
    let second;


    // AutoSave locks Draft first
    if (role === "autosave") {

        first = "draft";
        second = "submission";

    }

    // FinalSubmit locks Submission first
    else if (role === "submit") {

        first = "submission";
        second = "draft";

    }

    else {

        console.log(
            "Role must be autosave or submit"
        );

        client.close();
        return;
    }


    console.log("");
    console.log(`Node-${nodeId} (${role}) started`);

    console.log(
        `Node-${nodeId}: First lock = ${first}`
    );

    console.log(
        `Node-${nodeId}: Second lock = ${second}`
    );


    // Request first lock
    const firstGranted =
        await acquire(first);


    if (!firstGranted) {

        console.log(
            `Node-${nodeId}: ABORTED`
        );

        client.close();
        return;
    }


    console.log(
        `Node-${nodeId}: Holding '${first}'`
    );


    // Give the other node time to obtain its first lock
    await new Promise(
        resolve => setTimeout(resolve, 1500)
    );


    // Request second lock
    const secondGranted =
        await acquire(second);


    if (!secondGranted) {

        console.log("");
        console.log(
            `Node-${nodeId}: DEADLOCK RESOLUTION`
        );

        console.log(
            `Node-${nodeId}: Releasing '${first}'`
        );

        await release(first);

        client.close();

        return;
    }


    // Both locks acquired
    console.log("");
    console.log(
        `Node-${nodeId} ENTERED CRITICAL SECTION`
    );

    console.log(
        `Node-${nodeId} is performing PlaceMate booking...`
    );


    // Simulate booking
    await new Promise(
        resolve => setTimeout(resolve, 2000)
    );


    // Release second lock
    await release(second);

    // Release first lock
    await release(first);


    console.log(
        `Node-${nodeId} DONE`
    );


    client.close();
}


run();