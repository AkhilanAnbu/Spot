import express from "express";
import { challengesDb } from "../db/challengesDb.js";
import { acceptancesDb } from "../db/acceptancesDb.js";
import { usersDb } from "../db/usersDb.js";
import { requireValidId } from "../middleware/requireValidId.js";

const router = express.Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

// today as a plain YYYY-MM-DD string, so it compares directly against the
// startDate/endDate strings a challenge stores (both are zero-padded ISO dates)
function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// how many calendar days a date window covers, inclusive of both ends —
// used to sanity-check that a target isn't larger than the window
function daysInRange(startDate, endDate) {
  const start = new Date(startDate + "T12:00:00Z");
  const end = new Date(endDate + "T12:00:00Z");
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

// Decide a finished challenge's outcome from how many days the user marked done.
// A challenge is only ever resolved once its window has closed.
function resolveStatus(acceptance, challenge) {
  return acceptance.completedDays.length >= challenge.targetDays
    ? "completed"
    : "failed";
}

// CREATE a challenge template
router.post("/", async (req, res) => {
  try {
    const description = String(req.body.description || "")
      .trim()
      .replace(/\s+/g, " ");
    const { startDate, endDate, targetDays } = req.body;

    // the window has to make sense before anyone can work toward it
    if (!description || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: "description, startDate and endDate are required" });
    }
    if (description.length > 200) {
      return res
        .status(400)
        .json({ error: "Description must be 200 characters or fewer" });
    }
    if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
      return res.status(400).json({ error: "Enter valid challenge dates" });
    }
    // a challenge posted in the past would be hidden the moment it's created
    if (startDate < todayString()) {
      return res.status(400).json({ error: "Start date can't be in the past" });
    }
    if (endDate < startDate) {
      return res
        .status(400)
        .json({ error: "End date must be on or after the start date" });
    }
    // targetDays is how many days the accepter must complete, 1..windowLength
    const windowLength = daysInRange(startDate, endDate);
    if (
      !Number.isInteger(targetDays) ||
      targetDays < 1 ||
      targetDays > windowLength
    ) {
      return res.status(400).json({
        error: `Pick a target from 1 to ${windowLength} day${windowLength === 1 ? "" : "s"}`,
      });
    }

    // no accepter/status/proof — those live on each person's acceptance now
    const challenge = await challengesDb.create({
      creatorId: req.user._id,
      description,
      startDate,
      endDate,
      targetDays,
      createdAt: new Date(),
    });

    res.status(201).json(challenge);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ every challenge, each enriched for the logged-in user with the creator's
// profile and this user's own acceptance (if any). Expired challenges the user
// never accepted are dropped, and any accepted challenge whose window has closed
// is resolved to completed/failed on the way out.
router.get("/", async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const today = todayString();
    const challenges = await challengesDb.findAll();

    // look up every creator in one query, so we don't hit the users collection
    // per card
    const creatorIds = [
      ...new Set(challenges.map((c) => c.creatorId.toString())),
    ];
    const creators = await usersDb.findByIds(creatorIds);
    // map creator id -> sanitized profile for a quick lookup below
    const creatorById = {};
    creators.forEach((user) => {
      creatorById[user._id.toString()] = usersDb.sanitize(user);
    });

    // pull all this user's acceptances in one query and key them by challenge,
    // so the loop below reads from memory instead of hitting the database once
    // per challenge (that per-challenge lookup was slow against a remote db)
    const myAcceptances = await acceptancesDb.findByUser(myId);
    const acceptanceByChallenge = {};
    myAcceptances.forEach((a) => {
      acceptanceByChallenge[a.challengeId.toString()] = a;
    });

    // resolve any still-open acceptance whose window has closed, saving each
    // once. these writes run together rather than one after another.
    const toResolve = challenges.filter((challenge) => {
      const a = acceptanceByChallenge[challenge._id.toString()];
      return a && a.status === "accepted" && challenge.endDate < today;
    });
    await Promise.all(
      toResolve.map(async (challenge) => {
        const a = acceptanceByChallenge[challenge._id.toString()];
        const status = resolveStatus(a, challenge);
        acceptanceByChallenge[challenge._id.toString()] =
          await acceptancesDb.update(a._id, { status });
      }),
    );

    const enriched = [];
    for (const challenge of challenges) {
      const myAcceptance = acceptanceByChallenge[challenge._id.toString()];

      // an expired challenge you never accepted is dead to everyone — hide it
      if (!myAcceptance && challenge.endDate < today) {
        continue;
      }

      enriched.push({
        ...challenge,
        creator: creatorById[challenge.creatorId.toString()] || null,
        myAcceptance: myAcceptance || null,
      });
    }

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ACCEPT a challenge — creates this user's own acceptance without touching the
// shared challenge, so it stays open for everyone else
router.put("/:id/accept", requireValidId, async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const challenge = await challengesDb.findById(req.objectId);
    if (!challenge) {
      return res.status(404).json({ error: "Challenge not found" });
    }
    // a closed window can't be started
    if (challenge.endDate < todayString()) {
      return res.status(400).json({ error: "Challenge has already ended" });
    }
    // you can't take on your own challenge
    if (challenge.creatorId.toString() === myId) {
      return res
        .status(400)
        .json({ error: "You cannot accept your own challenge" });
    }
    // one acceptance per person per challenge
    const existing = await acceptancesDb.findForUserAndChallenge(
      myId,
      challenge._id,
    );
    if (existing) {
      return res
        .status(409)
        .json({ error: "You have already accepted this challenge" });
    }

    const acceptance = await acceptancesDb.create({
      challengeId: challenge._id,
      userId: req.user._id,
      status: "accepted",
      completedDays: [],
      acceptedAt: new Date(),
    });

    res.status(201).json(acceptance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MARK a day done (or undo it) on the caller's acceptance
router.post("/:id/day", requireValidId, async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const challenge = await challengesDb.findById(req.objectId);
    if (!challenge) {
      return res.status(404).json({ error: "Challenge not found" });
    }

    const acceptance = await acceptancesDb.findForUserAndChallenge(
      myId,
      challenge._id,
    );
    // only someone who accepted the challenge can log days for it
    if (!acceptance) {
      return res
        .status(403)
        .json({ error: "You have not accepted this challenge" });
    }
    // once it's resolved the window is closed and nothing more can be logged
    if (acceptance.status !== "accepted") {
      return res
        .status(400)
        .json({ error: "This challenge is already finished" });
    }

    // the day being marked has to fall inside the challenge window
    const date = req.body.date;
    if (!isValidDateString(date)) {
      return res.status(400).json({ error: "Enter a valid completion date" });
    }
    if (date < challenge.startDate || date > challenge.endDate) {
      return res
        .status(400)
        .json({ error: "That date is outside the challenge window" });
    }
    if (date > todayString()) {
      return res
        .status(400)
        .json({ error: "You cannot mark a future day as complete" });
    }

    // marking is a toggle: on if the day isn't there yet, off if it is.
    // one entry per date keeps the count honest. (undo is fine here because the
    // challenge is still accepted — a finished one is locked out above.)
    const already = acceptance.completedDays.includes(date);
    const completedDays = already
      ? acceptance.completedDays.filter((d) => d !== date)
      : [...acceptance.completedDays, date].sort();

    // hitting the target completes the challenge right away and moves it to Done
    const status =
      completedDays.length >= challenge.targetDays ? "completed" : "accepted";

    const updated = await acceptancesDb.update(acceptance._id, {
      completedDays,
      status,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a challenge — creator only, and only while nobody has accepted it,
// since deleting would otherwise wipe other people's progress
router.delete("/:id", requireValidId, async (req, res) => {
  try {
    const challenge = await challengesDb.findById(req.objectId);
    if (!challenge) {
      return res.status(404).json({ error: "Challenge not found" });
    }
    if (challenge.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Not your challenge" });
    }
    const accepted = await acceptancesDb.countForChallenge(challenge._id);
    if (accepted > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete a challenge someone has accepted" });
    }

    await challengesDb.remove(challenge._id);
    res.json({ message: "Challenge deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
