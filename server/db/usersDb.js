import { connectDB } from "./connection.js";
import { ObjectId } from "mongodb";

function sanitize(user) {
  if (!user) return user;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function create(userData) {
  const db = await connectDB();
  const result = await db.collection("users").insertOne(userData);
  return { _id: result.insertedId, ...userData };
}

async function findById(id) {
  const db = await connectDB();
  return db.collection("users").findOne({ _id: new ObjectId(id) });
}

async function findByIds(ids) {
  if (ids.length === 0) return [];
  const db = await connectDB();
  const objectIds = ids.map((id) => new ObjectId(id));
  return db
    .collection("users")
    .find({ _id: { $in: objectIds } })
    .toArray();
}

async function findByUsername(username) {
  const db = await connectDB();
  return db.collection("users").findOne({ username });
}

async function findByEmail(email) {
  const db = await connectDB();
  const exactEmail = new RegExp(`^${escapeRegex(email)}$`, "i");
  return db.collection("users").findOne({ email: exactEmail });
}

// Search text is escaped before it reaches MongoDB. Without this, characters
// such as "*", "[", or nested groups are interpreted as a regular expression,
// which can produce surprising matches or an unnecessarily expensive query.
async function search(term, excludeUserId) {
  const db = await connectDB();
  const safeTerm = escapeRegex(term.trim().slice(0, 50));
  const matcher = { $regex: safeTerm, $options: "i" };

  return db
    .collection("users")
    .find({
      _id: { $ne: new ObjectId(excludeUserId) },
      $or: [{ username: matcher }, { displayName: matcher }],
    })
    .project({
      username: 1,
      displayName: 1,
      bio: 1,
      favoriteGym: 1,
      createdAt: 1,
    })
    .limit(20)
    .toArray();
}

async function update(id, updates) {
  const db = await connectDB();
  return db
    .collection("users")
    .findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: "after" },
    );
}

async function remove(id) {
  const db = await connectDB();
  const result = await db
    .collection("users")
    .deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}

export const usersDb = {
  create,
  findById,
  findByIds,
  findByUsername,
  findByEmail,
  search,
  update,
  remove,
  sanitize,
};
