import { z } from "zod";
import { idSchema } from "@/lib/validation";

/** Longest comment, in characters. The database enforces the same limit. */
export const COMMENT_MAX_LENGTH = 1000;
/** Comments per page (top-level comments; their replies come with them). */
export const COMMENTS_PER_PAGE = 20;
/** Replies loaded with each top-level comment. */
export const REPLIES_PER_COMMENT = 50;

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, "Write something first")
  .max(COMMENT_MAX_LENGTH, `Keep it under ${COMMENT_MAX_LENGTH.toLocaleString("en-US")} characters`);

export const createCommentSchema = z
  .object({
    body: commentBodySchema,
    /** Reply to this top-level comment. */
    parentId: idSchema.optional(),
  })
  .strict();

export const listCommentsSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(COMMENTS_PER_PAGE),
});

/** Safe to show anyone: name, handle, and picture only. */
export interface CommentAuthor {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** Verified as an actual user of this market's startup's product. */
  verified: boolean;
}

export interface CommentView {
  id: string;
  /** Null once removed. */
  body: string | null;
  createdAt: string;
  removed: boolean;
  /** Null once removed. */
  author: CommentAuthor | null;
  /** The signed-in viewer wrote it, or is an admin. */
  canRemove: boolean;
  /** Visible replies, oldest first. Empty for replies themselves. */
  replies: CommentView[];
}

/** Why the viewer can or cannot post. */
export type PostingState = "allowed" | "signed-out" | "finish-onboarding";

export interface DiscussionPage {
  comments: CommentView[];
  /** Visible comments and replies on the market. */
  total: number;
  nextCursor: string | null;
  posting: PostingState;
  /** The viewer, so the composer can show their picture. */
  viewer: { name: string; avatarUrl: string | null } | null;
}
