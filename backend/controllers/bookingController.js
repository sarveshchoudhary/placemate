import bcrypt from "bcryptjs";
import { 
  PutCommand, 
  ScanCommand, 
  GetCommand, 
  UpdateCommand 
} from "@aws-sdk/lib-dynamodb";
import { ddb, s3 } from "../config/aws.js";
import { v4 as uuidv4 } from "uuid";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { sendEmail } from "./emailController.js";


// ================= FILE UPLOAD =================
export const uploadFile = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = `uploads/${uuidv4()}-${file.originalname}`;

    await s3.send(new PutObjectCommand({
      Bucket: "placemate-uploads",
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype
    }));

    const fileUrl = `https://placemate-uploads.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    res.json({ url: fileUrl });

  } catch (err) {
    console.error("S3 Upload Error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
};


// ================= CREATE BOOKING =================
export const createBooking = async (req, res) => {
  try {
    const {
      name,
      email,
      service,
      type,
      date,
      startTime,
      endTime,
      quantity
    } = req.body;

    // ✅ VALIDATION
    if (!name || !email || !service || !date || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const isEquipment = type === "equipment";

    const item = {
      PK: `BOOKING#${uuidv4()}`,
      email,
      name,
      type: type || "venue",

      // ✅ CORE FIX
      service,
      classroom: isEquipment ? null : service,
      equipment: isEquipment ? service : null,

      quantity: quantity || 1,

      date,
      startTime,
      endTime,
      status: "Pending"
    };

    console.log("Saving booking:", item);

    await ddb.send(new PutCommand({
      TableName: "placemate-bookings",
      Item: item
    }));

    // ✅ EMAIL
    const bookingName = isEquipment ? item.equipment : item.classroom;

    try {
      await sendEmail(
        email,
        "Booking Request Submitted",
        `Hello ${name}, your booking for ${bookingName} on ${date} is pending approval.`
      );
    } catch (emailErr) {
      console.error("Email error:", emailErr.message);
    }

    res.status(201).json({
      message: "Booking saved successfully",
      booking: item
    });

  } catch (err) {
    console.error("DynamoDB ERROR:", err);
    res.status(500).json({ error: "Failed to save booking" });
  }
};


// ================= GET ALL BOOKINGS =================
export const getBookings = async (req, res) => {
  try {
    const data = await ddb.send(new ScanCommand({
      TableName: "placemate-bookings"
    }));

    res.json(data.Items);

  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};


// ================= GET USER BOOKINGS =================
export const getUserBookings = async (req, res) => {
  try {
    const { email } = req.query;

    const data = await ddb.send(new ScanCommand({
      TableName: "placemate-bookings"
    }));

    const filtered = data.Items.filter(item => item.email === email);

    res.json(filtered);

  } catch (err) {
    console.error("Fetch user bookings error:", err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};


// ================= UPDATE STATUS (ADMIN) =================
export const updateBookingStatus = async (req, res) => {
  try {
    const { PK, status } = req.body;

    if (!PK || !status) {
      return res.status(400).json({ error: "Missing PK or status" });
    }

    await ddb.send(new UpdateCommand({
      TableName: "placemate-bookings",
      Key: { PK },
      UpdateExpression: "set #s = :s",
      ExpressionAttributeNames: {
        "#s": "status"
      },
      ExpressionAttributeValues: {
        ":s": status
      }
    }));

    const result = await ddb.send(new GetCommand({
      TableName: "placemate-bookings",
      Key: { PK }
    }));

    const booking = result.Item;

    if (booking && booking.email) {
      const bookingName =
        booking.type === "equipment"
          ? booking.equipment
          : booking.classroom;

      try {
        await sendEmail(
          booking.email,
          "Booking Status Update",
          `Hello ${booking.name}, your booking for ${bookingName} on ${booking.date} is ${status}`
        );
      } catch (emailErr) {
        console.error("Email error:", emailErr.message);
      }
    }

    res.json({ message: "Status updated" });

  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Failed to update status" });
  }
};


// ================= SIGNUP =================
export const signupUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existing = await ddb.send(new GetCommand({
      TableName: "placemate-users",
      Key: { email }
    }));

    if (existing.Item) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await ddb.send(new PutCommand({
      TableName: "placemate-users",
      Item: {
        email,
        name,
        password: hashedPassword,
        createdAt: new Date().toISOString()
      }
    }));

    res.json({ message: "Signup successful" });

  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
};


// ================= LOGIN =================
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await ddb.send(new GetCommand({
      TableName: "placemate-users",
      Key: { email }
    }));

    const user = result.Item;

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ error: "Invalid password" });
    }

    res.json({
      message: "Login successful",
      user: {
        email: user.email,
        name: user.name
      }
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error" });
  }
};


// ================= LOGOUT =================
export const logoutUser = async (req, res) => {
  res.json({ message: "Logged out successfully" });
};