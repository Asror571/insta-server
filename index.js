console.log("STARTING SERVICE...");
process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

import Fastify from "fastify";
import cors from "@fastify/cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import fs from "node:fs";
import util from "node:util";
import { pipeline } from "node:stream";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

import { Post } from "./post.model.js";
import { User } from "./user.model.js";

import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

dotenv.config();
const pump = util.promisify(pipeline);

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, { origin: true });
await fastify.register(multipart);

const __dirname = path.resolve(
  path.dirname(decodeURI(new URL(import.meta.url).pathname)),
);
fastify.register(fastifyStatic, {
  root: path.join(__dirname, "uploads"),
  prefix: "/uploads/",
});

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/instagram_clone";
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
try {
  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected to", MONGO_URI);
} catch (err) {
  console.error("Failed to connect to MongoDB:", err);
  process.exit(1);
}

const authenticate = async (request, reply) => {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("No valid authorization header");
    }
    const token = authHeader.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);
    request.user = await User.findOne({ _id: decoded.id });
    if (!request.user) {
      throw new Error();
    }
  } catch (err) {
    reply.code(401).send({ error: "Please authenticate." });
  }
};

fastify.post("/signup", async (request, reply) => {
  try {
    const { username, password, email, fullName } = request.body || {};
    if (!username || !password) {
      return reply.code(400).send({ error: "Username va password kerak" });
    }
    const exists = await User.findOne({ username });
    if (exists) {
      return reply.code(409).send({ error: "Username band" });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hash, email, fullName });
    await user.save();

    const postDoc = await Post.findOne({ username });
    if (!postDoc) {
      await new Post({ username, images: [] }).save();
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    return reply.code(201).send({ ok: true, token });
  } catch (err) {
    console.error("/signup error:", err);
    return reply.code(500).send({ error: "Internal Server Error" });
  }
});

fastify.post("/login", async (request, reply) => {
  try {
    const { username, password } = request.body || {};
    if (!username || !password) {
      return reply.code(400).send({ error: "Username va password kerak" });
    }
    const user = await User.findOne({ username });
    if (!user) {
      return reply.code(401).send({ error: "Username yoki parol xato" });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return reply.code(401).send({ error: "Username yoki parol xato" });
    }
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    return reply.send({ ok: true, token });
  } catch (err) {
    console.error("/login error:", err);
    return reply.code(500).send({ error: "Internal Server Error" });
  }
});

fastify.get(
  "/posts",
  { preHandler: [authenticate] },
  async function (request, reply) {
    try {
      const username = request.user.username;
      if (!username) {
        return reply.send([]);
      }
      const post = await Post.findOne({ username });
      if (post && Array.isArray(post.images)) {
        const imagesWithUrls = post.images.map(
          (imagePath) => `/uploads/${imagePath}`,
        );
        return reply.send(imagesWithUrls);
      }
      return reply.send([]);
    } catch (err) {
      console.error("/posts error:", err);
      return reply.code(500).send({ error: "Internal Server Error" });
    }
  },
);

fastify.post(
  "/posts",
  { preHandler: [authenticate] },
  async function (request, reply) {
    const username = request.user.username;
    if (!username) {
      return reply.code(401).send({ error: "Not authenticated" });
    }

    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: "No file uploaded" });
      }

      const extension = path.extname(data.filename);
      const randomName = crypto.randomBytes(16).toString("hex") + extension;
      const uploadPath = path.join(__dirname, "uploads", randomName);

      await pump(data.file, fs.createWriteStream(uploadPath));

      await Post.updateOne(
        { username },
        { $push: { images: randomName } },
        { upsert: true },
      );

      reply.send({ ok: true, filePath: `/uploads/${randomName}` });
    } catch (err) {
      console.error("/posts (upload) error:", err);
      reply
        .code(500)
        .send({ error: "Internal server error during file upload" });
    }
  },
);

fastify.get(
  "/feed",
  { preHandler: [authenticate] },
  async function (request, reply) {
    try {
      const allPosts = await Post.find({});
      const feed = allPosts.flatMap((userPosts) => {
        return userPosts.images.map((imagePath) => ({
          username: userPosts.username,
          image: `/uploads/${imagePath}`,
        }));
      });

      feed.sort(() => Math.random() - 0.5);

      return reply.send(feed);
    } catch (err) {
      console.error("/feed error:", err);
      return reply.code(500).send({ error: "Internal Server Error" });
    }
  },
);

fastify.get("/health", async function (request, reply) {
  return { ok: true };
});

const onClose = async () => {
  try {
    await mongoose.disconnect();
    await fastify.close();
    console.log("Service shut down cleanly.");
  } catch (err) {
    console.error("Error during shutdown:", err);
  }
};
process.on("SIGINT", onClose);
process.on("SIGTERM", onClose);

try {
  const port = Number(process.env.PORT || 3001);
  await fastify.listen({ port, host: "0.0.0.0" });
  console.log(`Server listening on ${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
