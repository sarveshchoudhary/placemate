import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bookingRoutes from "./routes/bookingRoutes.js";

 
dotenv.config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());
import uploadRoutes from "./routes/uploadRoutes.js";

// ================= ROUTES =================
app.use("/api", bookingRoutes);
app.use("/api", uploadRoutes);

// Root route (for testing + frontend link)
app.get("/", (req, res) => {
  res.send(`
    <h2>🚀 Backend is Running</h2>
    <p>API is working successfully.</p>
    <p><strong>API Endpoints:</strong></p>
    <ul>
      <li>GET /api/bookings</li>
      <li>POST /api/book</li>
    </ul>
    <a href="http://127.0.0.1:5500" target="_blank">
      👉 Open Frontend
    </a>
  `);
});

// ================= ERROR HANDLER =================
app.use((err, req, res, next) => {
  console.error("Server Error:", err);
  res.status(500).json({ error: "Something went wrong" });
});

// ================= SERVER =================
const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log("=================================");
  console.log(`🚀 Backend running at: http://localhost:${PORT}`);
  console.log(`🌐 Frontend link: http://127.0.0.1:5500`);
  console.log("=================================");
});