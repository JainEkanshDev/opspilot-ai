import express from "express";
import cors from "cors";
import { db } from "./db.js";
import type { ResultSetHeader,RowDataPacket } from "mysql2";


const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

// API server health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "opspilot-backend",
  });
});

// Database health check
app.get("/health/db", async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT 1 AS result");

    res.json({
      status: "ok",
      service: "opspilot-backend",
      database: "connected",
      result: rows,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      status: "error",
      service: "opspilot-backend",
      database: "disconnected",
    });
  }
});

// Retrieve tasks
app.get("/api/tasks", async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, user_id, title, description, status, priority,
              due_at, created_at, updated_at
       FROM tasks
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("Failed to retrieve tasks:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve tasks",
    });
  }
});

// Create a task
app.post("/api/tasks", async (req, res) => {
  const { userId, title, description, priority, dueAt } = req.body;

  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    typeof title !== "string" ||
    !title.trim()
  ) {
    res.status(400).json({
      success: false,
      message: "userId must be a positive integer and title is required",
    });
    return;
  }

  const validPriorities = ["low", "medium", "high", "urgent"];

  if (
    priority !== undefined &&
    !validPriorities.includes(priority)
  ) {
    res.status(400).json({
      success: false,
      message: "priority must be low, medium, high, or urgent",
    });
    return;
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== "string"
  ) {
    res.status(400).json({
      success: false,
      message: "description must be a string or null",
    });
    return;
  }

  if (
    dueAt !== undefined &&
    dueAt !== null &&
    (typeof dueAt !== "string" ||
      Number.isNaN(Date.parse(dueAt)))
  ) {
    res.status(400).json({
      success: false,
      message: "dueAt must be a valid date string or null",
    });
    return;
  }

  try {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO tasks
        (user_id, title, description, priority, due_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        title.trim(),
        description ?? null,
        priority ?? "medium",
        dueAt ?? null,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      taskId: result.insertId,
    });
  } catch (error) {
    console.error("Failed to create task:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create task. Verify that the user exists.",
    });
  }
});



app.patch("/api/tasks/:id/status", async (req, res) => {
  const taskId = Number(req.params.id);
  const { status } = req.body;

  const validStatuses = [
    "pending",
    "in_progress",
    "completed",
    "failed",
  ];

  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    res.status(400).json({
      success: false,
      message: "A valid task ID is required",
    });
    return;
  }

  if (typeof status !== "string" || !validStatuses.includes(status)) {
    res.status(400).json({
      success: false,
      message: "Invalid task status",
    });
    return;
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // Lock the task row while this transaction runs.
    const [tasks] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM tasks WHERE id = ? FOR UPDATE",
      [taskId]
    );

    if (tasks.length === 0) {
      await connection.rollback();

      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    // Update the task status.
    await connection.execute<ResultSetHeader>(
      "UPDATE tasks SET status = ? WHERE id = ?",
      [status, taskId]
    );

    // Record the status change in the activity history.
    await connection.execute(
      `INSERT INTO task_events (task_id, event_type, details)
       VALUES (?, ?, ?)`,
      [taskId, "status_changed", JSON.stringify({ status })]
    );

    // Save both operations together.
    await connection.commit();

    res.json({
      success: true,
      message: "Task status updated",
      taskId,
      status,
    });
  } catch (error) {
    await connection.rollback();

    console.error("Failed to update task status:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update task status",
    });
  } finally {
    connection.release();
  }
});


app.post("/api/ai/tasks", async (req, res) => {
  const { userId, request } = req.body;

  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    typeof request !== "string" ||
    request.trim().length < 3 ||
    request.length > 2000
  ) {
    res.status(400).json({
      success: false,
      message: "A valid userId and request are required",
    });
    return;
  }

  try {
    // 1. Ask the local AI service to interpret the request.
    const aiResponse = await fetch(
      "http://localhost:8000/api/interpret",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: request.trim() }),
        signal: AbortSignal.timeout(95000),
      }
    );

    if (!aiResponse.ok) {
      res.status(502).json({
        success: false,
        message: "AI service returned an error",
      });
      return;
    }

    const aiResult = await aiResponse.json();
    const interpretation = aiResult?.data;

    // 2. Validate the model's interpretation before using it.
    const validPriorities = ["low", "medium", "high", "urgent"];

    if (
      aiResult.success !== true ||
      aiResult.ai_model_connected !== true ||
      !interpretation ||
      interpretation.intent !== "create_task" ||
      typeof interpretation.title !== "string" ||
      !interpretation.title.trim() ||
      interpretation.title.trim().length > 200 ||
      !validPriorities.includes(interpretation.priority) ||
      interpretation.status !== "pending"
    ) {
      res.status(422).json({
        success: false,
        message: "AI could not produce a valid task creation request",
      });
      return;
    }

    // 3. Create the task in MySQL.
    
const connection = await db.getConnection();

let taskId: number;

try {
  await connection.beginTransaction();

  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO tasks
      (user_id, title, description, priority, status)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      interpretation.title.trim(),
      request.trim(),
      interpretation.priority,
      "pending",
    ]
  );

  taskId = result.insertId;

  await connection.execute(
    `INSERT INTO task_events (task_id, event_type, details)
     VALUES (?, ?, ?)`,
    [
      taskId,
      "created_by_ai",
      JSON.stringify({
        source: "ollama",
        model: aiResult.model,
        originalRequest: request.trim(),
        priority: interpretation.priority,
      }),
    ]
  );

  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  connection.release();
}


    // 4. Return the created task details.
    res.status(201).json({
      success: true,
      message: "AI interpreted the request and created the task",
      taskId: taskId,
      title: interpretation.title.trim(),
      priority: interpretation.priority,
      status: "pending",
    });
  } catch (error) {
    console.error("AI task creation failed:", error);

    res.status(502).json({
      success: false,
      message:
        "Could not complete AI task creation. Check that the AI service is running.",
    });
  }
});


app.get("/api/tasks/:id/activity", async (req, res) => {
  const taskId = Number(req.params.id);

  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    res.status(400).json({
      success: false,
      message: "A valid task ID is required",
    });
    return;
  }

  try {
    // Check that the task exists.
    const [tasks] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM tasks WHERE id = ?",
      [taskId]
    );

    if (tasks.length === 0) {
      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    // Retrieve its activity history, newest first.
    const [events] = await db.execute<RowDataPacket[]>(
      `SELECT id, task_id, event_type, details, created_at
       FROM task_events
       WHERE task_id = ?
       ORDER BY created_at DESC, id DESC`,
      [taskId]
    );

    res.json({
      success: true,
      taskId,
      data: events,
    });
  } catch (error) {
    console.error("Failed to retrieve task activity:", error);

    res.status(500).json({
      success: false,
      message: "Failed to retrieve task activity",
    });
  }
});





app.listen(PORT, () => {
  console.log(`OpsPilot backend running at http://localhost:${PORT}`);
});
