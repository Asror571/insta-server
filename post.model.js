import mongoose from "mongoose";

const postSchema = new mongoose.Schema({
  username: { type: String, required: true },
  images: [String],
});

export const Post = mongoose.model("Post", postSchema);
