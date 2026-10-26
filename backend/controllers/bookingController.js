import bcrypt from "bcryptjs";
import { pool } from "../config/database.js";

const toBooking = (row, type) => ({
  PK: `${type.toUpperCase()}#${row.id}`,
  id: row.id,
  name: row.name,
  email: row.email,
  service: type === "equipment" ? row.equipment : row.classroom,
  classroom: type === "equipment" ? null : row.classroom,
  equipment: type === "equipment" ? row.equipment : null,
  quantity: type === "equipment" ? row.quantity : 1,
  date: row.booking_date,
  startTime: row.start_time,
  endTime: row.end_time,
  status: row.status || "Pending",
  type
});

const parseBookingKey = (key) => {
  const [type, id] = String(key).split("#");
  if (!["VENUE", "CLASSROOM", "EQUIPMENT", "BOOKING"].includes(type) || !Number.isInteger(Number(id))) {
    return null;
  }
  return { type, id: Number(id) };
};

export const createBooking = async (req, res) => {
  let connection;
  let lockAcquired = false;

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

    if (!name || !email || !service || !date || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (startTime >= endTime) {
      return res.status(400).json({ error: "End time must be after start time" });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [lockResult] = await connection.execute(
      "SELECT GET_LOCK('placemate:booking-conflict', 10) AS lock_acquired"
    );
    lockAcquired = lockResult[0]?.lock_acquired === 1;

    if (!lockAcquired) {
      await connection.rollback();
      return res.status(503).json({
        error: "Booking service is busy. Please try again."
      });
    }

    const [classroomConflicts] = await connection.execute(
      `SELECT id
       FROM classroom_bookings
       WHERE booking_date = ?
         AND start_time < ?
         AND end_time > ?
       LIMIT 1`,
      [date, endTime, startTime]
    );
    const [equipmentConflicts] = await connection.execute(
      `SELECT id
       FROM equipment_bookings
       WHERE booking_date = ?
         AND start_time < ?
         AND end_time > ?
       LIMIT 1`,
      [date, endTime, startTime]
    );

    if (classroomConflicts.length > 0 || equipmentConflicts.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        error: "This date and time are already booked. Please choose another slot."
      });
    }

    if (type === "equipment") {
      const [result] = await connection.execute(
        `INSERT INTO equipment_bookings
          (equipment, name, email, booking_date, start_time, end_time, quantity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [service, name, email, date, startTime, endTime, Number(quantity) || 1]
      );
      await connection.commit();
      return res.status(201).json({
        message: "Booking saved successfully",
        booking: {
          PK: `EQUIPMENT#${result.insertId}`,
          name, email, service, equipment: service, quantity: Number(quantity) || 1,
          date, startTime, endTime, status: "pending", type: "equipment"
        }
      });
    }

    const [result] = await connection.execute(
      `INSERT INTO classroom_bookings
        (classroom, name, email, booking_date, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [service, name, email, date, startTime, endTime]
    );
    await connection.commit();

    res.status(201).json({
      message: "Booking saved successfully",
      booking: {
        PK: `CLASSROOM#${result.insertId}`,
        name, email, service, classroom: service,
        date, startTime, endTime, status: "pending", type: "venue"
      }
    });
  } catch (err) {
    if (connection) {
      await connection.rollback().catch((rollbackError) => {
        console.error("MySQL booking rollback error:", rollbackError);
      });
    }
    console.error("MySQL booking error:", err);
    res.status(500).json({ error: "Failed to save booking" });
  } finally {
    if (connection && lockAcquired) {
      await connection
        .execute("SELECT RELEASE_LOCK('placemate:booking-conflict')")
        .catch((releaseError) => {
          console.error("MySQL booking lock release error:", releaseError);
        });
    }
    connection?.release();
  }
};

export const getBookings = async (req, res) => {
  try {
    const [classrooms] = await pool.execute(
      "SELECT id, classroom, name, email, booking_date, start_time, end_time, status FROM classroom_bookings"
    );
    const [equipment] = await pool.execute(
      "SELECT id, equipment, name, email, booking_date, start_time, end_time, quantity, status FROM equipment_bookings"
    );

    res.json([
      ...classrooms.map((row) => toBooking(row, "venue")),
      ...equipment.map((row) => toBooking(row, "equipment"))
    ]);
  } catch (err) {
    console.error("MySQL fetch error:", err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

export const getUserBookings = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const [classrooms] = await pool.execute(
      "SELECT id, classroom, name, email, booking_date, start_time, end_time, status FROM classroom_bookings WHERE email = ?",
      [email]
    );
    const [equipment] = await pool.execute(
      "SELECT id, equipment, name, email, booking_date, start_time, end_time, quantity, status FROM equipment_bookings WHERE email = ?",
      [email]
    );

    res.json([
      ...classrooms.map((row) => toBooking(row, "venue")),
      ...equipment.map((row) => toBooking(row, "equipment"))
    ]);
  } catch (err) {
    console.error("MySQL user bookings error:", err);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

export const deleteBooking = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { email } = req.body;
    const bookingId = Number(id);

    if (!email || !Number.isInteger(bookingId) || bookingId <= 0) {
      return res.status(400).json({ error: "A valid booking ID and email are required" });
    }

    const table = type === "equipment"
      ? "equipment_bookings"
      : type === "venue"
        ? "classroom_bookings"
        : null;

    if (!table) {
      return res.status(400).json({ error: "Invalid booking type" });
    }

    const [result] = await pool.execute(
      `DELETE FROM ${table} WHERE id = ? AND email = ?`,
      [bookingId, email]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json({ message: "Booking cancelled successfully" });
  } catch (err) {
    console.error("MySQL booking deletion error:", err);
    res.status(500).json({ error: "Failed to cancel booking" });
  }
};

export const updateBookingStatus = async (req, res) => {
  try {
    const key = parseBookingKey(req.body.PK);
    const { status } = req.body;
    if (!key || !status) return res.status(400).json({ error: "Missing valid PK or status" });

    if (key.type === "EQUIPMENT" || key.type === "BOOKING") {
      const [result] = await pool.execute(
        "UPDATE equipment_bookings SET status = ? WHERE id = ?",
        [status, key.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Booking not found" });
      }
    } else {
      const [result] = await pool.execute(
        "UPDATE classroom_bookings SET status = ? WHERE id = ?",
        [status, key.id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Booking not found" });
      }
    }

    res.json({ message: "Status updated" });
  } catch (err) {
    console.error("MySQL status update error:", err);
    res.status(500).json({ error: "Failed to update status" });
  }
};

export const signupUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required" });
    }

    const [existing] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) return res.status(400).json({ error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword]
    );

    res.json({ message: "Signup successful" });
  } catch (err) {
    console.error("MySQL signup error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.execute(
      "SELECT id, name, email, password FROM users WHERE email = ?",
      [email]
    );
    const user = rows[0];

    if (!user) return res.status(401).json({ error: "User not found" });
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid password" });
    }

    res.json({
      message: "Login successful",
      user: { id: user.id, email: user.email, name: user.name }
    });
  } catch (err) {
    console.error("MySQL login error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

export const logoutUser = async (req, res) => {
  res.json({ message: "Logged out successfully" });
};

export const uploadFile = async (req, res) => {
  res.status(501).json({
    error: "File uploads are disabled until a MySQL file-storage table is added"
  });
};
