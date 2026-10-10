// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketDiscussion } from "@/components/discussion/MarketDiscussion";
import type { CommentView, DiscussionPage } from "@/lib/market-view/discussion-types";
import { formatCommentTime } from "@/lib/market-view/format";

// Clerk's modal is out of scope here; render the trigger as-is.
vi.mock("@clerk/nextjs", () => ({ SignInButton: ({ children }: { children: ReactNode }) => children }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const comment = (id: string, body: string, extra: Partial<CommentView> = {}): CommentView => ({
  id,
  body,
  createdAt: minutesAgo(5),
  removed: false,
  author: { id: `u-${id}`, name: "Ana Costa", username: "ana", avatarUrl: "https://example.com/ana.png", verified: false },
  canRemove: false,
  replies: [],
  ...extra,
});

const page = (overrides: Partial<DiscussionPage> = {}): DiscussionPage => ({
  comments: [comment("c1", "Leaning YES.", { replies: [comment("r1", "Agreed.", { author: { id: "u2", name: "Ben Lee", username: null, avatarUrl: null, verified: true } })] })],
  total: 2,
  nextCursor: null,
  posting: "allowed",
  viewer: { name: "Me Myself", avatarUrl: null },
  ...overrides,
});

type Handler = (init?: RequestInit) => Response;

function mockApi(handlers: { list: Handler; post?: Handler; remove?: Handler }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("/api/markets/demo/comments/") && init?.method === "DELETE" && handlers.remove) return handlers.remove(init);
    if (url === "/api/markets/demo/comments" && init?.method === "POST" && handlers.post) return handlers.post(init);
    if (url.startsWith("/api/markets/demo/comments")) return handlers.list(init);
    throw new Error(`Unexpected fetch ${url}`);
  });
}

const renderDiscussion = () => render(createElement(MarketDiscussion, { slug: "demo" }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarketDiscussion", () => {
  it("shows names, pictures, times, replies, and the verified badge", async () => {
    mockApi({ list: () => json(200, { data: page() }) });
    renderDiscussion();
    const list = await screen.findByRole("list", { name: "Comments" });
    expect(within(list).getByText("Ana Costa")).toBeInTheDocument();
    expect(within(list).getByText("@ana")).toBeInTheDocument();
    expect(list.querySelector('img[src="https://example.com/ana.png"]')).not.toBeNull();
    expect(within(list).getAllByText("5m ago")[0]!.closest("time")).toHaveAttribute("datetime");
    const replies = within(list).getByRole("list", { name: "Replies" });
    expect(within(replies).getByText("Ben Lee")).toBeInTheDocument();
    expect(within(replies).getByText("Verified user")).toBeInTheDocument();
    expect(screen.getByText("2 comments")).toBeInTheDocument();
  });

  it("asks signed-out readers to sign in instead of showing the composer", async () => {
    mockApi({ list: () => json(200, { data: page({ posting: "signed-out", viewer: null }) }) });
    renderDiscussion();
    expect(await screen.findByText("Sign in to join the discussion.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a comment")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
  });

  it("posts a comment and shows it at the top", async () => {
    const user = userEvent.setup();
    const post = vi.fn<Handler>(() => json(201, { data: comment("c2", "Taking NO.", { createdAt: new Date().toISOString(), canRemove: true }) }));
    mockApi({ list: () => json(200, { data: page() }), post });
    renderDiscussion();
    await user.type(await screen.findByLabelText("Add a comment"), "  Taking NO.  ");
    await user.click(screen.getByRole("button", { name: "Post" }));
    expect(JSON.parse(String(post.mock.calls[0]![0]?.body))).toEqual({ body: "Taking NO." });
    const items = within(screen.getByRole("list", { name: "Comments" })).getAllByRole("article");
    expect(items[0]).toHaveTextContent("Taking NO.");
    expect(items[0]).toHaveTextContent("just now");
    expect(screen.getByText("3 comments")).toBeInTheDocument();
  });

  it("replies under the original comment", async () => {
    const user = userEvent.setup();
    const post = vi.fn<Handler>(() => json(201, { data: comment("r2", "Good point.") }));
    mockApi({ list: () => json(200, { data: page() }), post });
    renderDiscussion();
    await user.click(await screen.findByRole("button", { name: "Reply" }));
    await user.type(screen.getByLabelText("Write a reply"), "Good point.");
    // The second "Reply" button submits the reply box.
    await user.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    expect(JSON.parse(String(post.mock.calls[0]![0]?.body))).toEqual({ body: "Good point.", parentId: "c1" });
    expect(within(screen.getByRole("list", { name: "Replies" })).getByText("Good point.")).toBeInTheDocument();
  });

  it("explains rate limits without losing the draft", async () => {
    const user = userEvent.setup();
    mockApi({
      list: () => json(200, { data: page() }),
      post: () => json(429, { error: { code: "RATE_LIMITED", message: "Too many requests" } }),
    });
    renderDiscussion();
    const box = await screen.findByLabelText("Add a comment");
    await user.type(box, "Hello");
    await user.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You're posting quickly. Try again in a minute.");
    expect(box).toHaveValue("Hello");
  });

  it("removes your own comment after confirming", async () => {
    const user = userEvent.setup();
    const remove = vi.fn<Handler>(() => json(200, { data: { id: "c9", removed: true } }));
    mockApi({ list: () => json(200, { data: page({ comments: [comment("c9", "Mine", { canRemove: true })], total: 1 }) }), remove });
    renderDiscussion();
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(screen.getByText("Remove this comment?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("No comments yet. Start the discussion.")).toBeInTheDocument();
  });
});

describe("formatCommentTime", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("uses minutes, hours, days, then the date", () => {
    expect(formatCommentTime("2026-10-10T11:59:40Z", now)).toBe("just now");
    expect(formatCommentTime("2026-10-10T11:45:00Z", now)).toBe("15m ago");
    expect(formatCommentTime("2026-10-10T07:00:00Z", now)).toBe("5h ago");
    expect(formatCommentTime("2026-10-07T12:00:00Z", now)).toBe("3d ago");
    expect(formatCommentTime("2026-09-01T12:00:00Z", now)).toBe("Sep 1, 2026");
  });
});
