const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { createClient } = require("redis");

// ============================================
// LOAD BOOKING PROTO
// ============================================

const packageDefinition = protoLoader.loadSync(
    __dirname + "/../proto/booking.proto"
);

const bookingProto =
    grpc.loadPackageDefinition(packageDefinition).booking;

// ============================================
// BACKEND CONFIGURATION
// ============================================

// Use IPv4 explicitly
const BACKEND = process.env.GRPC_BACKEND || "127.0.0.1:50051";

// Fresh cache expires after 10 seconds
const FRESH_TTL = 10;

// ============================================
// REDIS CLIENTS
// ============================================

const freshCache = createClient({
    socket: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: Number(process.env.REDIS_PORT || 6379),
        connectTimeout: 1000
    }
});

const staleCache = createClient({
    socket: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: Number(process.env.REDIS_PORT || 6379),
        connectTimeout: 1000
    }
});

// ============================================
// REDIS ERROR HANDLERS
// ============================================

freshCache.on("error", (err) => {
    console.log("[Redis Fresh] Error:", err.message);
});

staleCache.on("error", (err) => {
    console.log("[Redis Stale] Error:", err.message);
});

// ============================================
// CONNECT TO REDIS
// ============================================

async function connectRedis() {

    try {

        if (!freshCache.isOpen) {
            await freshCache.connect();
        }

        if (!staleCache.isOpen) {
            await staleCache.connect();
        }

        return true;

    } catch (error) {

        console.log("[Gateway] Redis unavailable:");
        console.log(error.message);

        return false;
    }
}

// ============================================
// CALL PLACE MATE gRPC BACKEND
// ============================================

function fetchFromBackend(classroom) {

    return new Promise((resolve, reject) => {

        console.log(
            `[Gateway] Connecting to backend ${BACKEND}...`
        );

        const client =
            new bookingProto.BookingService(
                BACKEND,
                grpc.credentials.createInsecure()
            );

        client.GetBooking(
            {
                classroom: classroom
            },
            {
                deadline: new Date(Date.now() + 5000)
            },
            (err, response) => {

                if (err) {

                    console.log("[Gateway] gRPC ERROR");
                    console.log("Code:", err.code);
                    console.log("Details:", err.details);

                    reject(err);

                } else {

                    console.log(
                        "[Gateway] Backend response received"
                    );

                    resolve(response);
                }
            }
        );
    });
}

// ============================================
// CACHE-ASIDE LOGIC
// ============================================

async function getBooking(classroom) {

    const freshKey =
        `fresh:booking:${classroom}`;

    const staleKey =
        `stale:booking:${classroom}`;

    let redisAvailable =
        await connectRedis();

    // ========================================
    // 1. CHECK FRESH CACHE
    // ========================================

    if (redisAvailable) {

        try {

            const cached =
                await freshCache.get(freshKey);

            if (cached) {

                console.log(
                    `[Gateway] CACHE HIT for ${classroom}`
                );

                return {
                    data: JSON.parse(cached),
                    source: "cache-hit"
                };
            }

            console.log(
                `[Gateway] CACHE MISS for ${classroom}`
            );

        } catch (error) {

            console.log(
                "[Gateway] Redis read failed:",
                error.message
            );

            redisAvailable = false;
        }
    }

    // ========================================
    // 2. CALL BACKEND
    // ========================================

    try {

        const data =
            await fetchFromBackend(classroom);

        console.log(
            `[Gateway] Fetched ${classroom} from BACKEND`
        );

        // ====================================
        // STORE IN REDIS
        // ====================================

        if (redisAvailable) {

            try {

                // Fresh cache
                await freshCache.set(
                    freshKey,
                    JSON.stringify(data),
                    {
                        EX: FRESH_TTL
                    }
                );

                // Stale cache
                await staleCache.set(
                    staleKey,
                    JSON.stringify(data)
                );

                console.log(
                    "[Gateway] Stored fresh + stale cache"
                );

            } catch (error) {

                console.log(
                    "[Gateway] Redis write failed:",
                    error.message
                );
            }
        }

        return {
            data: data,
            source: "backend"
        };

    } catch (error) {

        console.log(
            "[Gateway] BACKEND UNAVAILABLE"
        );

        // ====================================
        // 3. STALE CACHE FALLBACK
        // ====================================

        if (redisAvailable) {

            try {

                const stale =
                    await staleCache.get(staleKey);

                if (stale) {

                    console.log(
                        `[Gateway] Serving STALE cached copy for ${classroom}`
                    );

                    return {
                        data: JSON.parse(stale),
                        source: "stale-fallback"
                    };
                }

                console.log(
                    "[Gateway] No stale cache available"
                );

            } catch (error) {

                console.log(
                    "[Gateway] Could not read stale cache:",
                    error.message
                );
            }
        }

        throw new Error(
            "Booking unavailable"
        );
    }
}

// ============================================
// MAIN
// ============================================

async function main() {

    const classroom =
        process.argv[2] || "Lab-101";

    console.log("\n================================");
    console.log("PlaceMate Cache Gateway");
    console.log("Classroom:", classroom);
    console.log("================================\n");

    try {

        const result =
            await getBooking(classroom);

        console.log("\n========== RESULT ==========");

        console.log(
            `Source: ${result.source}`
        );

        console.log(
            "Booking Data:"
        );

        console.log(result.data);

        console.log(
            "============================\n"
        );

    } catch (error) {

        console.log(
            "\nERROR:",
            error.message
        );

    } finally {

        // Close Redis connections
        try {

            if (freshCache.isOpen) {
                await freshCache.quit();
            }

            if (staleCache.isOpen) {
                await staleCache.quit();
            }

        } catch (error) {
            // Ignore Redis closing errors
        }
    }
}

main();