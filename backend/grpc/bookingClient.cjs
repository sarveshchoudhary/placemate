const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const LamportClock = require("./lamportClock.cjs");

// Create Lamport Clock
const clock = new LamportClock();

const packageDefinition = protoLoader.loadSync(
    __dirname + "/../proto/booking.proto"
);

const bookingProto =
    grpc.loadPackageDefinition(packageDefinition).booking;

const client = new bookingProto.BookingService(
    "localhost:50051",
    grpc.credentials.createInsecure()
);

// Increment clock before sending event
const clientTime = clock.sendEvent();

console.log("Sending Booking Request...");
console.log("Client Lamport Clock:", clientTime);

client.CreateBooking(
    {
        name: "Sarvesh",
        email: "sarvesh@gmail.com",
        classroom: "Lab-101",
        date: "2026-07-30",
        time: "10:00-11:00",
        lamportTime: clientTime
    },
    (err, response) => {

        if (err) {
            console.log(err);
        } else {

            console.log("\nResponse Received:");
            console.log(response);

            // Update client clock after receiving server response
            const updatedTime =
                clock.receiveEvent(response.lamportTime);

            console.log(
                "Updated Client Lamport Clock:",
                updatedTime
            );
        }
    }
);