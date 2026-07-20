import express from "express";
import { pactsDb } from "../db/pactsDb.js";
import { usersDb } from "../db/usersDb.js";
import { sessionCountsDb } from "../db/sessionCountsDb.js";
import { requireValidId } from "../middleware/requireValidId.js";
import { mondayOf, addDays, streakFrom } from "../lib/streak.js";

const router = express.Router();

// how far back a streak is allowed to reach — a year of weeks is well past
// any streak worth showing, and it keeps the session query bounded
const MAX_STREAK_WEEKS = 52;

// checks that the logged-in user is one of the two partners on a pact
function isMember(pact, userId) {
  return (
    pact.partnerA.toString() === userId || pact.partnerB.toString() === userId
  );
}

// today as a plain YYYY-MM-DD string, to match how sessions store their date
function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// Works out a pact's streak and this week's progress from the session history.
// The streak is never stored — it's recomputed here every time a pact is read,
// so adding or deleting a session is reflected the next time the page loads.
async function withStreak(pact) {
  const today = todayString();
  const thisWeek = mondayOf(today);
  const oldestWeek = addDays(thisWeek, -7 * MAX_STREAK_WEEKS);
  const windowEnd = addDays(thisWeek, 6);

  // one query per partner covering every week we might look at
  const [countsA, countsB] = await Promise.all([
    sessionCountsDb.countByWeek(pact.partnerA, oldestWeek, windowEnd),
    sessionCountsDb.countByWeek(pact.partnerB, oldestWeek, windowEnd),
  ]);

  // a pact's streak only counts weeks after it went active, so start from
  // activatedAt; older seeded pacts have no activatedAt, so fall back to createdAt
  const startDate = pact.activatedAt || pact.createdAt;
  const activatedAt = startDate.toISOString().slice(0, 10);
  const currentStreak = streakFrom(
    countsA,
    countsB,
    pact.weeklyTarget,
    activatedAt,
    today,
  );

  // the week in progress is left out of the streak, so report it separately
  return {
    pact,
    currentStreak,
    weekCounts: {
      partnerA: countsA[thisWeek] || 0,
      partnerB: countsB[thisWeek] || 0,
    },
  };
}

// "proposer" if I sent this pact, "invited" if it was proposed to me
function roleOf(pact, myId) {
  return pact.proposedBy && pact.proposedBy.toString() === myId
    ? "proposer"
    : "invited";
}

// role + streak info shared by both the list and detail routes.
// a pending pact has no streak or weekly progress yet, so weekCounts is null;
// each route shapes its own "thisWeek" from weekCounts since the list keys it
// as you/partner while the detail page keys it as partnerA/partnerB
async function withRoleAndStreak(pact, myId) {
  const role = roleOf(pact, myId);
  if (pact.status !== "active") {
    return { role, currentStreak: null, weekCounts: null };
  }
  const streak = await withStreak(pact);
  return {
    role,
    currentStreak: streak.currentStreak,
    weekCounts: streak.weekCounts,
  };
}

// CREATE a new pact with a partner
router.post("/", async (req, res) => {
  try {
    const { partnerId, weeklyTarget } = req.body;
    const myId = req.user._id.toString();

    // weeklyTarget is how many workouts per week both partners commit to, 1-7
    if (
      !Number.isInteger(weeklyTarget) ||
      weeklyTarget < 1 ||
      weeklyTarget > 7
    ) {
      return res
        .status(400)
        .json({ error: "weeklyTarget must be a number from 1 to 7" });
    }
    // you can't be your own accountability partner
    if (partnerId === myId) {
      return res
        .status(400)
        .json({ error: "Cannot form a pact with yourself" });
    }

    // make sure the partner is a real, existing user
    const partner = await usersDb.findById(partnerId);
    if (!partner) {
      return res.status(400).json({ error: "Partner not found" });
    }

    // don't let the same two people form a second pact with each other
    const existingPact = await pactsDb.findBetween(myId, partnerId);
    if (existingPact) {
      return res
        .status(409)
        .json({ error: "A pact already exists between these two users" });
    }

    // the logged-in user is always partnerA, the person they invited is partnerB
    // no streak field — a pact's streak is worked out from its sessions on read
    // a new pact starts "pending": it isn't active until partnerB accepts it,
    // so activatedAt is null for now and the streak clock starts then
    const newPact = await pactsDb.create({
      partnerA: req.user._id,
      partnerB: partner._id,
      proposedBy: req.user._id,
      weeklyTarget,
      status: "pending",
      activatedAt: null,
      createdAt: new Date(),
    });

    res.status(201).json(newPact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ all pacts the logged-in user is part of, each with the partner's profile attached
router.get("/", async (req, res) => {
  try {
    const myId = req.user._id.toString();
    const pacts = await pactsDb.findByUser(myId);

    // for each pact, figure out which side is "me" and attach the OTHER
    // person's profile so the frontend can show "you + your partner"
    const pactsWithPartner = await Promise.all(
      pacts.map(async (pact) => {
        const iAmPartnerA = pact.partnerA.toString() === myId;
        const partnerId = iAmPartnerA ? pact.partnerB : pact.partnerA;
        const partner = await usersDb.findById(partnerId);

        // role and streak are worked out the same way for both routes
        const { role, currentStreak, weekCounts } = await withRoleAndStreak(
          pact,
          myId,
        );

        return {
          ...pact,
          partner: usersDb.sanitize(partner),
          role,
          currentStreak,
          // weekCounts is null on a pending pact, so `null && {...}` keeps
          // thisWeek null (not undefined) — this card is shown from my side,
          // so name the counts you/partner
          thisWeek: weekCounts && {
            you: iAmPartnerA ? weekCounts.partnerA : weekCounts.partnerB,
            partner: iAmPartnerA ? weekCounts.partnerB : weekCounts.partnerA,
            target: pact.weeklyTarget,
          },
        };
      }),
    );

    res.json(pactsWithPartner);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// READ one pact, with both partners' profiles attached
router.get("/:id", requireValidId, async (req, res) => {
  try {
    const pact = await pactsDb.findById(req.objectId);
    if (!pact) return res.status(404).json({ error: "Pact not found" });

    // only the two people in the pact are allowed to view it
    const myId = req.user._id.toString();
    if (!isMember(pact, myId)) {
      return res.status(403).json({ error: "Not a member of this pact" });
    }

    // fetch both profiles at once so the detail page can show both names
    const [partnerA, partnerB] = await Promise.all([
      usersDb.findById(pact.partnerA),
      usersDb.findById(pact.partnerB),
    ]);

    // role and streak are worked out the same way for both routes
    const { role, currentStreak, weekCounts } = await withRoleAndStreak(
      pact,
      myId,
    );

    res.json({
      ...pact,
      partnerA: usersDb.sanitize(partnerA),
      partnerB: usersDb.sanitize(partnerB),
      role,
      currentStreak,
      // weekCounts is null on a pending pact, so `null && {...}` keeps thisWeek
      // null (not undefined) — this page names both partners, so key the counts
      // by side rather than "you"
      thisWeek: weekCounts && {
        partnerA: weekCounts.partnerA,
        partnerB: weekCounts.partnerB,
        target: pact.weeklyTarget,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE a pact's weekly target
router.put("/:id", requireValidId, async (req, res) => {
  try {
    const pact = await pactsDb.findById(req.objectId);
    if (!pact) return res.status(404).json({ error: "Pact not found" });

    // only the two partners can change the pact's target
    const myId = req.user._id.toString();
    if (!isMember(pact, myId)) {
      return res.status(403).json({ error: "Not a member of this pact" });
    }

    // the target is locked once the pact is active — it can only be tweaked
    // while it's still pending, and only by the person who proposed it
    const iProposed = pact.proposedBy && pact.proposedBy.toString() === myId;
    if (pact.status !== "pending" || !iProposed) {
      return res
        .status(400)
        .json({ error: "Can only edit a pending pact you proposed" });
    }

    // weeklyTarget is the only field a pact allows editing
    const { weeklyTarget } = req.body;
    if (
      !Number.isInteger(weeklyTarget) ||
      weeklyTarget < 1 ||
      weeklyTarget > 7
    ) {
      return res
        .status(400)
        .json({ error: "weeklyTarget must be a number from 1 to 7" });
    }

    const updatedPact = await pactsDb.updateTarget(req.objectId, weeklyTarget);
    res.json(updatedPact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ACCEPT a pending pact that was proposed to you
router.put("/:id/accept", requireValidId, async (req, res) => {
  try {
    const pact = await pactsDb.findById(req.objectId);
    if (!pact) return res.status(404).json({ error: "Pact not found" });

    // only the two partners can act on the pact at all
    const myId = req.user._id.toString();
    if (!isMember(pact, myId)) {
      return res.status(403).json({ error: "Not a member of this pact" });
    }

    // a pact can only be accepted while it's still pending
    if (pact.status !== "pending") {
      return res.status(400).json({ error: "Pact is not pending" });
    }
    // the person who proposed the pact can't accept their own proposal
    if (pact.proposedBy && pact.proposedBy.toString() === myId) {
      return res
        .status(400)
        .json({ error: "You cannot accept a pact you proposed" });
    }

    // going active starts the streak clock, so stamp activatedAt now
    const updatedPact = await pactsDb.updateStatus(req.objectId, {
      status: "active",
      activatedAt: new Date(),
    });
    res.json(updatedPact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requireValidId, async (req, res) => {
  try {
    const pact = await pactsDb.findById(req.objectId);
    if (!pact) return res.status(404).json({ error: "Pact not found" });

    const myId = req.user._id.toString();
    if (!isMember(pact, myId)) {
      return res.status(403).json({ error: "Not a member of this pact" });
    }

    await pactsDb.remove(req.objectId);
    return res.json({
      message: pact.status === "active" ? "Pact dissolved" : "Pact deleted",
    });
  } catch (err) {
    console.error("Pact deletion failed:", err);
    return res.status(500).json({ error: "Could not remove pact" });
  }
});

export default router;
