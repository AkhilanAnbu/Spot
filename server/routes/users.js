import express from "express";
import { usersDb } from "../db/usersDb.js";
import { requireValidId } from "../middleware/requireValidId.js";

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// SEARCH users by username/displayName, for finding a workout partner.
router.get("/", async (req, res) => {
  try {
    const term = String(req.query.search || "").trim();
    if (!term) {
      return res.json([]);
    }
    if (term.length > 50) {
      return res
        .status(400)
        .json({ error: "Search must be 50 characters or fewer" });
    }

    const users = await usersDb.search(term, req.user._id);
    return res.json(users.map(usersDb.sanitize));
  } catch (err) {
    console.error("User search failed:", err);
    return res.status(500).json({ error: "Could not search users" });
  }
});

// READ one user's profile by id.
router.get("/:id", requireValidId, async (req, res) => {
  try {
    const user = await usersDb.findById(req.objectId);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(usersDb.sanitize(user));
  } catch (err) {
    console.error("Could not load user:", err);
    return res.status(500).json({ error: "Could not load user" });
  }
});

// UPDATE a profile — only the logged-in user can edit their own profile.
router.put("/:id", requireValidId, async (req, res) => {
  try {
    if (req.objectId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Cannot edit another user" });
    }

    const displayName = cleanText(req.body.displayName);
    const bio = cleanText(req.body.bio);
    const favoriteGym = cleanText(req.body.favoriteGym);
    const email = normalizeEmail(req.body.email);

    if (!displayName) {
      return res.status(400).json({ error: "Display name is required" });
    }
    if (displayName.length > 60) {
      return res
        .status(400)
        .json({ error: "Display name must be 60 characters or fewer" });
    }
    if (bio.length > 500) {
      return res
        .status(400)
        .json({ error: "Bio must be 500 characters or fewer" });
    }
    if (favoriteGym.length > 100) {
      return res
        .status(400)
        .json({ error: "Favorite gym must be 100 characters or fewer" });
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }

    const emailOwner = await usersDb.findByEmail(email);
    if (emailOwner && emailOwner._id.toString() !== req.user._id.toString()) {
      return res.status(409).json({ error: "Email is already taken" });
    }

    const updatedUser = await usersDb.update(req.objectId, {
      displayName,
      bio,
      favoriteGym,
      email,
    });

    if (!updatedUser) return res.status(404).json({ error: "User not found" });
    return res.json(usersDb.sanitize(updatedUser));
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: "Email is already taken" });
    }
    console.error("Profile update failed:", err);
    return res.status(500).json({ error: "Could not update profile" });
  }
});

// DELETE a user's own account, then log them out.
router.delete("/:id", requireValidId, async (req, res) => {
  try {
    if (req.objectId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Cannot delete another user" });
    }

    const deleted = await usersDb.remove(req.objectId);
    if (!deleted) return res.status(404).json({ error: "User not found" });

    return req.logout((logoutErr) => {
      if (logoutErr) {
        console.error("Could not log out deleted account:", logoutErr);
        return res
          .status(500)
          .json({ error: "Account deleted, but logout failed" });
      }

      return req.session.destroy((sessionErr) => {
        if (sessionErr) {
          console.error(
            "Could not destroy deleted account session:",
            sessionErr,
          );
          return res
            .status(500)
            .json({ error: "Account deleted, but session cleanup failed" });
        }
        return res.json({ message: "Account deleted" });
      });
    });
  } catch (err) {
    console.error("Account deletion failed:", err);
    return res.status(500).json({ error: "Could not delete account" });
  }
});

export default router;
