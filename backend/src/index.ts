import express from "express";
import cors from "cors";

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health-check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "opspilot-backend",
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`OpsPilot backend running at http://localhost:${PORT}`);
});