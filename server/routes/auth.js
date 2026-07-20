import express from "express";
import bcrypt from "bcryptjs";
import passport from "../auth/passport.js";
import { usersDb } from "../db/usersDb.js";

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const SESSION_COOKIE_NAME = "spot.sid";

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cleanDisplayName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function registrationError({ username, email, password, displayName }) {
  if (!username || !email || !password || !displayName) {
    return "All fields are required";
  }
  if (!USERNAME_PATTERN.test(username)) {
    return "Username must be 3-30 characters using letters, numbers, or underscores";
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return "Enter a valid email address";
  }
  if (displayName.length > 60) {
    return "Display name must be 60 characters or fewer";
  }
  if (password.length < 6 || password.length > 72) {
    return "Password must be between 6 and 72 characters";
  }
  return null;
}

// REGISTER a new user, then log them in automatically.
router.post("/register", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const email = normalizeEmail(req.body.email);
    const displayName = cleanDisplayName(req.body.displayName);
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    const validationError = registrationError({
      username,
      email,
      password,
      displayName,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const [existingUsername, existingEmail] = await Promise.all([
      usersDb.findByUsername(username),
      usersDb.findByEmail(email),
    ]);

    if (existingUsername) {
      return res.status(409).json({ error: "Username is already taken" });
    }
    if (existingEmail) {
      return res.status(409).json({ error: "Email is already taken" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await usersDb.create({
      username,
      email,
      passwordHash,
      displayName,
      bio: "",
      favoriteGym: "",
      createdAt: new Date(),
    });

    req.login(newUser, (err) => {
      if (err) {
        console.error(
          "Could not create login session after registration:",
          err,
        );
        return res
          .status(500)
          .json({ error: "Could not complete registration" });
      }
      return res.status(201).json(usersDb.sanitize(newUser));
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ error: "Username or email is already taken" });
    }
    console.error("Registration failed:", err);
    return res.status(500).json({ error: "Could not register account" });
  }
});

// LOGIN an existing user.
router.post("/login", (req, res, next) => {
  req.body.username = normalizeUsername(req.body.username);
  if (!req.body.username || typeof req.body.password !== "string") {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  return passport.authenticate("local", (err, user) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    return req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.json(usersDb.sanitize(user));
    });
  })(req, res, next);
});

// LOGOUT the current user and invalidate both the stored session and cookie.
router.post("/logout", (req, res) => {
  req.logout((logoutErr) => {
    if (logoutErr) {
      console.error("Logout failed:", logoutErr);
      return res.status(500).json({ error: "Could not log out" });
    }

    return req.session.destroy((sessionErr) => {
      if (sessionErr) {
        console.error("Session destruction failed:", sessionErr);
        return res.status(500).json({ error: "Could not log out" });
      }

      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      return res.json({ message: "Logged out" });
    });
  });
});

// GET the currently logged-in user.
router.get("/me", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Not logged in" });
  }
  return res.json(usersDb.sanitize(req.user));
});

export default router;
