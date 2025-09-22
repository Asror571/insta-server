import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import { Post } from "./post.model.js";

dotenv.config();

const FAKE_USERS = ["nature_lover", "travel_blogger", "food_critic"];
const IMAGE_COUNT = 5;

async function downloadImage(url, filename) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    const __dirname = path.resolve(
      path.dirname(decodeURI(new URL(import.meta.url).pathname)),
    );
    const uploadsDir = path.join(__dirname, "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, filename);
    await fs.writeFile(filePath, Buffer.from(buffer));
    console.log(`Downloaded: ${filename}`);
    return filename;
  } catch (error) {
    console.error(`Error downloading ${filename}:`, error);
    throw error;
  }
}

async function seedDatabase() {
  console.log("Connecting to MongoDB...");
  const MONGO_URI =
    process.env.MONGO_URI || "mongodb://localhost:27017/instagram_clone";
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected.");

    console.log("Clearing old fake posts...");
    await Post.deleteMany({ username: { $in: FAKE_USERS } });

    console.log(`Downloading ${IMAGE_COUNT} new images...`);
    const imagePromises = [];
    for (let i = 0; i < IMAGE_COUNT; i++) {
      const imageUrl = `https://picsum.photos/800/800?random=${Date.now() + i}`;
      const filename = `seed_${Date.now() + i}.jpg`;
      imagePromises.push(downloadImage(imageUrl, filename));
    }

    const downloadedFiles = await Promise.all(imagePromises);
    console.log("All images downloaded successfully!");

    console.log("Creating posts in database...");
    const postPromises = [];
    for (const filename of downloadedFiles) {
      const randomUser =
        FAKE_USERS[Math.floor(Math.random() * FAKE_USERS.length)];
      const promise = Post.updateOne(
        { username: randomUser },
        { $push: { images: filename } },
        { upsert: true },
      );
      postPromises.push(promise);
    }

    await Promise.all(postPromises);

    console.log(
      `Successfully seeded ${downloadedFiles.length} posts for fake users!`,
    );
    console.log("Fake users:", FAKE_USERS);
  } catch (error) {
    console.error("Error during seeding:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Database connection closed.");
  }
}

seedDatabase();
