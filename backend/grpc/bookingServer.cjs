const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const LamportClock = require("./lamportClock.cjs");

dotenv.config();

const clock = new LamportClock();
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || "pm_db",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true
});

const packageDefinition = protoLoader.loadSync(
    __dirname + "/../proto/booking.proto"
);
const bookingProto = grpc.loadPackageDefinition(packageDefinition).booking;

function createBooking(call, callback) {
    const request = call.request;
    const serverTime = clock.receiveEvent(request.lamportTime || 0);
    const [startTime, endTime] = String(request.time).split("-").map((value) => value.trim());

    pool.execute(
        `INSERT INTO classroom_bookings
            (classroom, name, email, booking_date, start_time, end_time, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [request.classroom, request.name, request.email, request.date, startTime, endTime]
    )
        .then(([result]) => callback(null, {
            success: true,
            message: `Booking ${result.insertId} created successfully`,
            lamportTime: serverTime
        }))
        .catch((error) => {
            console.error("[gRPC] MySQL create error:", error);
            callback({ code: grpc.status.INTERNAL, details: "Failed to save booking to MySQL" });
        });
}

function getBooking(call, callback) {
    const classroom = call.request.classroom;

    pool.execute(
        `SELECT name, booking_date, start_time, end_time, status
         FROM classroom_bookings
         WHERE classroom = ?
         ORDER BY id DESC
         LIMIT 1`,
        [classroom]
    )
        .then(([rows]) => {
            if (!rows.length) {
                return callback({ code: grpc.status.NOT_FOUND, details: "Booking not found" });
            }
            const booking = rows[0];
            callback(null, {
                success: true,
                message: `${booking.name} booked ${classroom} on ${booking.booking_date} ` +
                    `${booking.start_time}-${booking.end_time} (${booking.status})`,
                lamportTime: clock.increment()
            });
        })
        .catch((error) => {
            console.error("[gRPC] MySQL lookup error:", error);
            callback({ code: grpc.status.INTERNAL, details: "Failed to read booking from MySQL" });
        });
}

const server = new grpc.Server();
server.addService(bookingProto.BookingService.service, {
    CreateBooking: createBooking,
    GetBooking: getBooking
});

server.bindAsync(
    "0.0.0.0:50051",
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
        if (err) {
            console.error(err);
            process.exitCode = 1;
            return;
        }
        console.log(`gRPC Server Running on Port ${port}`);
    }
);
