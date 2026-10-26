import express from "express";
import multer from "multer";

import {
  createBooking,
  getBookings,
  loginUser,
  logoutUser,
  signupUser,
  getUserBookings,
  deleteBooking,
  updateBookingStatus,
  uploadFile
} from "../controllers/bookingController.js";
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

// Routes
router.post("/book", createBooking);
router.get("/bookings", getBookings);
router.post("/login", loginUser);
router.post("/signup", signupUser);
router.post("/logout", logoutUser);
router.get("/my-bookings", getUserBookings); 
router.delete("/bookings/:type/:id", deleteBooking);
router.put("/update-status", updateBookingStatus);
router.post("/upload", upload.single("file"), uploadFile);

export default router;