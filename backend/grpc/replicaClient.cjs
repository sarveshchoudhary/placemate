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

function save(replica, key, content) {

    const client =
        new replicaProto.ReplicaService(
            REPLICAS[replica],
            grpc.credentials.createInsecure()
        );

    return new Promise((resolve, reject) => {

        client.SaveValue(
            {
                key: key,
                content: content,
                lamport_timestamp: 0,
                origin_replica: ""
            },
            (error, response) => {

                if (error) {
                    reject(error);
                } else {

                    console.log(
                        `[Client] Saved on Replica-${replica}: ` +
                        `"${content}"`
                    );

                    console.log(
                        `[Client] Timestamp: ` +
                        `${response.lamport_timestamp}`
                    );

                    resolve(response);
                }
            }
        );
    });
}

function read(replica, key) {

    const client =
        new replicaProto.ReplicaService(
            REPLICAS[replica],
            grpc.credentials.createInsecure()
        );

    return new Promise((resolve, reject) => {

        client.GetValue(
            { key: key },
            (error, response) => {

                if (error) {
                    reject(error);
                } else {
                    resolve(response);
                }
            }
        );
    });
}

async function main() {

    const key = "Lab-101";

    console.log(
        "\n=== PlaceMate Eventual Consistency Experiment ===\n"
    );

    console.log(
        "Two users are booking the same classroom."
    );

    console.log(
        "Writer 1 -> Replica A"
    );

    console.log(
        "Writer 2 -> Replica C\n"
    );

    // Two nearly simultaneous writes
    const writer1 = save(
        "A",
        key,
        "Sarvesh - 10:00 AM"
    );

    await new Promise(
        resolve => setTimeout(resolve, 50)
    );

    const writer2 = save(
        "C",
        key,
        "Rahul - 10:00 AM"
    );

    await Promise.all([
        writer1,
        writer2
    ]);

    console.log(
        "\n=== Immediately after writes ==="
    );

    for (const replica of ["A", "B", "C"]) {

        const result =
            await read(replica, key);

        console.log(
            `Replica-${replica}: "${result.content}" ` +
            `(timestamp=${result.lamport_timestamp}, ` +
            `origin=${result.origin_replica})`
        );
    }

    console.log(
        "\nWaiting for gossip replication..."
    );

    await new Promise(
        resolve => setTimeout(resolve, 2000)
    );

    console.log(
        "\n=== After convergence ==="
    );

    const results = [];

    for (const replica of ["A", "B", "C"]) {

        const result =
            await read(replica, key);

        console.log(
            `Replica-${replica}: "${result.content}" ` +
            `(timestamp=${result.lamport_timestamp}, ` +
            `origin=${result.origin_replica})`
        );

        results.push(result.content);
    }

    if (
        results[0] === results[1] &&
        results[1] === results[2]
    ) {

        console.log(
            "\n*** CONVERGED ***"
        );

        console.log(
            "All replicas have the same booking value."
        );

    } else {

        console.log(
            "\n*** NOT YET CONVERGED ***"
        );
    }
}

main();