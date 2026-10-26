const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync(
    __dirname + "/loadbalance.proto"
);

const loadbalanceProto =
    grpc.loadPackageDefinition(packageDefinition).loadbalance;

function startServer(port) {

    const serverName = `Worker-${port}`;

    const server = new grpc.Server();

    server.addService(
        loadbalanceProto.WorkerService.service,
        {
            HandleRequest: (call, callback) => {

              const requestId = call.request.requestId;

                // Random processing time
                const workTime =
                    Math.floor(Math.random() * 2000) + 1000;

                console.log(
                    `[${serverName}] Handling request ${requestId}`
                );

                console.log(
                    `[${serverName}] Processing for ${workTime} ms`
                );

                setTimeout(() => {

                    console.log(
                        `[${serverName}] Finished request ${requestId}`
                    );

                    callback(null, {
                        requestId: requestId,
			handledBy: serverName,
                        status: "done"
                    });

                }, workTime);
            }
        }
    );

    server.bindAsync(
        `localhost:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, actualPort) => {

            if (err) {
                console.error(err);
                return;
            }

            console.log(
                `${serverName} listening on port ${actualPort}`
            );
        }
    );
}

const port = parseInt(process.argv[2]);

startServer(port);