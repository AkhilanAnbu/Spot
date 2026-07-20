import express from "express";
import { ObjectId } from "mongodb";
import { connectDB } from "../db/connection.js";
import { requireValidId } from "../middleware/requireValidId.js";

const router = express.Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EXERCISES = 30;

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeExerciseName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateSessionPayload(body) {
  const date = body?.date;
  const notes = String(body?.notes || "").trim();
  const incomingExercises = body?.exercises;

  if (!isValidDateString(date)) {
    return { error: "Enter a valid workout date" };
  }
  if (date > todayString()) {
    return { error: "Workout date cannot be in the future" };
  }
  if (!Array.isArray(incomingExercises) || incomingExercises.length === 0) {
    return { error: "Add at least one exercise" };
  }
  if (incomingExercises.length > MAX_EXERCISES) {
    return {
      error: `A workout can contain at most ${MAX_EXERCISES} exercises`,
    };
  }
  if (notes.length > 2000) {
    return { error: "Notes must be 2000 characters or fewer" };
  }

  const exercises = [];
  for (const exercise of incomingExercises) {
    const name = normalizeExerciseName(exercise?.name);
    const sets = Number(exercise?.sets);
    const reps = Number(exercise?.reps);
    const weight = Number(exercise?.weight);

    if (!name || name.length > 80) {
      return { error: "Each exercise needs a name of 80 characters or fewer" };
    }
    if (!Number.isInteger(sets) || sets < 1 || sets > 100) {
      return { error: `Sets for ${name} must be a whole number from 1 to 100` };
    }
    if (!Number.isInteger(reps) || reps < 1 || reps > 1000) {
      return {
        error: `Reps for ${name} must be a whole number from 1 to 1000`,
      };
    }
    if (!Number.isFinite(weight) || weight < 0 || weight > 5000) {
      return { error: `Weight for ${name} must be between 0 and 5000` };
    }

    exercises.push({ name, sets, reps, weight });
  }

  return { value: { date, notes, exercises } };
}

// Return the heaviest prior weight for this user and exercise. Matching is
// case-insensitive so "Bench Press" and "bench press" share the same PR history.
async function priorBestWeight(db, userId, name, excludeId = null) {
  const match = { userId: new ObjectId(userId) };
  if (excludeId) match._id = { $ne: new ObjectId(excludeId) };

  const exactName = new RegExp(`^${escapeRegex(name)}$`, "i");
  const rows = await db
    .collection("sessions")
    .aggregate([
      { $match: match },
      { $unwind: "$exercises" },
      { $match: { "exercises.name": exactName } },
      { $sort: { "exercises.weight": -1 } },
      { $limit: 1 },
      { $project: { weight: "$exercises.weight", _id: 0 } },
    ])
    .toArray();

  return rows.length > 0 ? Number(rows[0].weight) : 0;
}

function capOnePRPerName(exercises) {
  const bestIndexByName = {};

  exercises.forEach((exercise, index) => {
    if (!exercise.isPR) return;
    const key = exercise.name.toLowerCase();
    const previousIndex = bestIndexByName[key];
    if (
      previousIndex === undefined ||
      exercise.weight > exercises[previousIndex].weight
    ) {
      bestIndexByName[key] = index;
    }
  });

  const keep = new Set(Object.values(bestIndexByName));
  return exercises.map((exercise, index) =>
    exercise.isPR && !keep.has(index) ? { ...exercise, isPR: false } : exercise,
  );
}

async function addPrFlags(db, userId, exercises, excludeId = null) {
  const withFlags = await Promise.all(
    exercises.map(async (exercise) => {
      const previousMax = await priorBestWeight(
        db,
        userId,
        exercise.name,
        excludeId,
      );
      return { ...exercise, isPR: exercise.weight > previousMax };
    }),
  );

  return capOnePRPerName(withFlags);
}

// READ all sessions for the logged-in user.
router.get("/", async (req, res) => {
  try {
    const db = await connectDB();
    const sessions = await db
      .collection("sessions")
      .find({ userId: req.user._id })
      .sort({ date: -1, createdAt: -1 })
      .toArray();
    return res.json(sessions);
  } catch (err) {
    console.error("Could not load sessions:", err);
    return res.status(500).json({ error: "Could not load workout history" });
  }
});

// READ one session by id.
router.get("/:id", requireValidId, async (req, res) => {
  try {
    const db = await connectDB();
    const workout = await db
      .collection("sessions")
      .findOne({ _id: req.objectId });

    if (!workout) return res.status(404).json({ error: "Session not found" });
    if (workout.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not your session" });
    }
    return res.json(workout);
  } catch (err) {
    console.error("Could not load session:", err);
    return res.status(500).json({ error: "Could not load session" });
  }
});

// UPDATE a session.
router.put("/:id", requireValidId, async (req, res) => {
  try {
    const parsed = validateSessionPayload(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const db = await connectDB();
    const existing = await db
      .collection("sessions")
      .findOne({ _id: req.objectId });

    if (!existing) return res.status(404).json({ error: "Session not found" });
    if (existing.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not your session" });
    }

    const { date, notes, exercises } = parsed.value;
    const dateClash = await db.collection("sessions").findOne({
      _id: { $ne: req.objectId },
      userId: req.user._id,
      date,
    });
    if (dateClash) {
      return res
        .status(409)
        .json({ error: "You already logged a workout on that date" });
    }

    const exercisesWithPr = await addPrFlags(
      db,
      existing.userId,
      exercises,
      existing._id,
    );

    const updates = { date, exercises: exercisesWithPr, notes };
    const updated = await db
      .collection("sessions")
      .findOneAndUpdate(
        { _id: req.objectId },
        { $set: updates },
        { returnDocument: "after" },
      );

    return res.json(updated);
  } catch (err) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ error: "You already logged a workout on that date" });
    }
    console.error("Session update failed:", err);
    return res.status(500).json({ error: "Could not update session" });
  }
});

// DELETE a session.
router.delete("/:id", requireValidId, async (req, res) => {
  try {
    const db = await connectDB();
    const existing = await db
      .collection("sessions")
      .findOne({ _id: req.objectId });

    if (!existing) return res.status(404).json({ error: "Session not found" });
    if (existing.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not your session" });
    }

    await db.collection("sessions").deleteOne({ _id: req.objectId });
    return res.json({ message: "Session deleted" });
  } catch (err) {
    console.error("Session deletion failed:", err);
    return res.status(500).json({ error: "Could not delete session" });
  }
});

// CREATE a session with server-side PR detection.
router.post("/", async (req, res) => {
  try {
    const parsed = validateSessionPayload(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const db = await connectDB();
    const userId = req.user._id;
    const { date, notes, exercises } = parsed.value;

    const dateClash = await db.collection("sessions").findOne({ userId, date });
    if (dateClash) {
      return res
        .status(409)
        .json({ error: "You already logged a workout on that date" });
    }

    const exercisesWithPr = await addPrFlags(db, userId, exercises);
    const workout = {
      userId,
      date,
      exercises: exercisesWithPr,
      notes,
      createdAt: new Date(),
    };

    const result = await db.collection("sessions").insertOne(workout);
    return res.status(201).json({ _id: result.insertedId, ...workout });
  } catch (err) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ error: "You already logged a workout on that date" });
    }
    console.error("Session creation failed:", err);
    return res.status(500).json({ error: "Could not log workout" });
  }
});

export default router;
