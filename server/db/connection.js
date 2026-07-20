import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let client;
let db;

export async function connectDB() {
  if (db) return db;

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is required");
  }

  if (!client) {
    client = new MongoClient(mongoUri);
  }

  await client.connect();
  db = client.db("spot");
  console.log("Connected to MongoDB");
  return db;
}
