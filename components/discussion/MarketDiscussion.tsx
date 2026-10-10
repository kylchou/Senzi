"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { BadgeCheck, MessageSquare } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { deleteComment, DiscussionError, fetchDiscussion, postComment } from "@/lib/market-view/discussion-client";
import { COMMENT_MAX_LENGTH, type CommentView, type DiscussionPage } from "@/lib/market-view/discussion-types";
import { formatCommentTime, formatDateTime } from "@/lib/market-view/format";

/** How often an open discussion checks for new comments while the tab is visible. */
const REFRESH_MS = 30_000;

/**
 * A market's discussion thread: newest comments first, each with replies.
 * Shows each person's name, picture, and when they posted. Anyone can read;
 * signed-in accounts that finished onboarding can post, reply, and remove
 * their own comments.
 */
export function MarketDiscussion({ slug }: { slug: string }) {
  const [page, setPage] = useState<DiscussionPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("");

  const load = useCallback(
    () =>
      fetchDiscussion(slug).then(
        (first) => {
          setFailed(false);
          setNow(Date.now());
          // Keep older pages the reader already loaded below the fresh first page.
          setPage((current) => {
            if (!current) return first;
            const fresh = new Set(first.comments.map((comment) => comment.id));
            return { ...first, comments: [...first.comments, ...current.comments.filter((comment) => !fresh.has(comment.id))] };
          });
        },
        () => setFailed(true),
      ),
    [slug],
  );

  useEffect(() => {
    let active = true;
    fetchDiscussion(slug).then(
      (first) => {
        if (!active) return;
        setNow(Date.now());
        setPage(first);
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [slug]);

  // New comments while the tab is open; relative times stay current.
  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const more = await fetchDiscussion(slug, page.nextCursor);
      setPage((current) =>
        current ? { ...current, comments: [...current.comments, ...more.comments], nextCursor: more.nextCursor } : more,
      );
      setNow(Date.now());
    } finally {
      setLoadingMore(false);
    }
  }

  function added(comment: CommentView, parentId?: string) {
    setPage((current) => {
      if (!current) return current;
      const comments = parentId
        ? current.comments.map((item) => (item.id === parentId ? { ...item, replies: [...item.replies, comment] } : item))
        : [comment, ...current.comments];
      return { ...current, comments, total: current.total + 1 };
    });
    setNow(Date.now());
    setAnnouncement(parentId ? "Reply posted" : "Comment posted");
  }

  function removed(commentId: string) {
    setPage((current) => {
      if (!current) return current;
      const comments = current.comments
        .map((item) => {
          if (item.id === commentId) return { ...item, removed: true, body: null, author: null, canRemove: false };
          return { ...item, replies: item.replies.filter((reply) => reply.id !== commentId) };
        })
        // A removed comment only stays as a placeholder while it has replies.
        .filter((item) => !item.removed || item.replies.length > 0);
      return { ...current, comments, total: Math.max(0, current.total - 1) };
    });
    setAnnouncement("Comment removed");
  }

  return (
    <section aria-labelledby="discussion-heading" className="surface-card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="discussion-heading" className="font-display text-lg font-bold text-ink-900">
          Discussion
        </h2>
        {page && (
          <span className="text-sm tabular-nums text-ink-500">
            {`${page.total.toLocaleString("en-US")} ${page.total === 1 ? "comment" : "comments"}`}
          </span>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {page === null ? (
        failed ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
            The discussion couldn&apos;t load.
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <DiscussionSkeleton />
        )
      ) : (
        <>
          <div className="mt-4">
            <PostingArea slug={slug} page={page} onPosted={(comment) => added(comment)} />
          </div>

          {page.comments.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 py-6 text-center">
              <MessageSquare className="size-6 text-ink-300" aria-hidden />
              <p className="text-sm text-ink-600">No comments yet. Start the discussion.</p>
            </div>
          ) : (
            <ol aria-label="Comments" className="mt-2 divide-y divide-hairline">
              {page.comments.map((comment) => (
                <li key={comment.id} className="py-4">
                  <Comment
                    slug={slug}
                    comment={comment}
                    now={now}
                    canReply={page.posting === "allowed"}
                    viewer={page.viewer}
                    onReply={(reply) => added(reply, comment.id)}
                    onRemoved={removed}
                  />
                </li>
              ))}
            </ol>
          )}

          {page.nextCursor && (
            <div className="mt-2 flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading" : "Show more comments"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PostingArea({ slug, page, onPosted }: { slug: string; page: DiscussionPage; onPosted: (comment: CommentView) => void }) {
  if (page.posting === "signed-out") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 px-4 py-3">
        <p className="text-sm text-ink-600">Sign in to join the discussion.</p>
        <SignInButton mode="modal">
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </SignInButton>
      </div>
    );
  }
  if (page.posting === "finish-onboarding") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 px-4 py-3">
        <p className="text-sm text-ink-600">Finish setting up your account to comment.</p>
        <ButtonLink href="/onboarding" variant="outline" size="sm">
          Finish setup
        </ButtonLink>
      </div>
    );
  }
  return <Composer slug={slug} viewer={page.viewer} onPosted={onPosted} />;
}

function Composer({
  slug,
  viewer,
  parentId,
  onPosted,
  onCancel,
  autoFocus = false,
}: {
  slug: string;
  viewer: DiscussionPage["viewer"];
  parentId?: string;
  onPosted: (comment: CommentView) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(autoFocus);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const remaining = COMMENT_MAX_LENGTH - text.length;
  const reply = parentId !== undefined;

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus();
  }, [autoFocus]);

  // Grow with the text, up to about ten lines.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 240)}px`;
  }, [text]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const comment = await postComment(slug, body, parentId);
      setText("");
      setActive(reply);
      onPosted(comment);
    } catch (caught) {
      setError(caught instanceof DiscussionError ? caught.message : "Couldn't post. Try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex gap-3">
      <UserAvatar name={viewer?.name ?? "You"} avatarUrl={viewer?.avatarUrl ?? null} size={reply ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          {reply ? "Write a reply" : "Add a comment"}
        </label>
        <textarea
          ref={areaRef}
          id={id}
          rows={1}
          value={text}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder={reply ? "Write a reply" : "Share your view on this market"}
          onFocus={() => setActive(true)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit();
            if (event.key === "Escape" && onCancel) onCancel();
          }}
          className="block w-full resize-none rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm leading-relaxed text-ink-900 transition-colors placeholder:text-ink-500 hover:border-ink-300 focus-visible:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
        />
        {(active || text) && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className={cn("text-xs", error ? "text-red-700" : "text-ink-500")} role={error ? "alert" : undefined}>
              {error ?? (remaining <= 150 ? `${remaining} characters left` : "")}
            </p>
            <div className="ml-auto flex items-center gap-1.5">
              {onCancel && (
                <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!text.trim() || posting}>
                {posting ? "Posting" : reply ? "Reply" : "Post"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

function Comment({
  slug,
  comment,
  now,
  canReply,
  viewer,
  isReply = false,
  onReply,
  onRemoved,
}: {
  slug: string;
  comment: CommentView;
  now: number;
  canReply: boolean;
  viewer: DiscussionPage["viewer"];
  isReply?: boolean;
  onReply?: (reply: CommentView) => void;
  onRemoved: (commentId: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await deleteComment(slug, comment.id);
      onRemoved(comment.id);
    } catch (caught) {
      setError(caught instanceof DiscussionError ? caught.message : "Couldn't remove it. Try again.");
      setRemoving(false);
      setConfirming(false);
    }
  }

  return (
    <article className="flex gap-3">
      {comment.author ? (
        <UserAvatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} size={isReply ? "sm" : "md"} />
      ) : (
        <span aria-hidden className={cn("shrink-0 rounded-full bg-ink-100", isReply ? "size-7" : "size-9")} />
      )}
      <div className="min-w-0 flex-1">
        {comment.removed || !comment.author ? (
          <p className="pt-1.5 text-sm italic text-ink-500">Comment removed</p>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="font-semibold text-ink-900" translate="no">
                {comment.author.name}
              </span>
              {comment.author.username && (
                <span className="text-xs text-ink-500" translate="no">
                  @{comment.author.username}
                </span>
              )}
              {comment.author.verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-700">
                  <BadgeCheck className="size-3.5 text-red-500" aria-hidden />
                  Verified user
                </span>
              )}
              <span aria-hidden className="text-ink-300">
                ·
              </span>
              <time dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)} className="text-xs text-ink-500">
                {formatCommentTime(comment.createdAt, new Date(now))}
              </time>
            </header>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-800">{comment.body}</p>
            <div className="mt-1.5 flex items-center gap-3 text-xs font-semibold text-ink-500">
              {canReply && !isReply && onReply && (
                <button type="button" onClick={() => setReplying((value) => !value)} className="rounded hover:text-ink-900">
                  Reply
                </button>
              )}
              {comment.canRemove &&
                (confirming ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-normal text-ink-600">Remove this comment?</span>
                    <button type="button" onClick={() => void remove()} disabled={removing} className="rounded text-red-700 hover:underline">
                      {removing ? "Removing" : "Remove"}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="rounded hover:text-ink-900">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirming(true)} className="rounded hover:text-ink-900">
                    Remove
                  </button>
                ))}
            </div>
            {error && (
              <p role="alert" className="mt-1 text-xs text-red-700">
                {error}
              </p>
            )}
          </>
        )}

        {replying && onReply && (
          <div className="mt-3">
            <Composer
              slug={slug}
              viewer={viewer}
              parentId={comment.id}
              autoFocus
              onCancel={() => setReplying(false)}
              onPosted={(reply) => {
                setReplying(false);
                onReply(reply);
              }}
            />
          </div>
        )}

        {comment.replies.length > 0 && (
          <ol aria-label="Replies" className="mt-3 space-y-3 border-l border-hairline pl-4">
            {comment.replies.map((reply) => (
              <li key={reply.id}>
                <Comment slug={slug} comment={reply} now={now} canReply={false} viewer={viewer} isReply onRemoved={onRemoved} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}

function DiscussionSkeleton() {
  return (
    <div role="status" aria-label="Loading discussion" className="mt-4 space-y-5">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <span className="size-9 shrink-0 animate-pulse rounded-full bg-ink-100" />
          <div className="flex-1 space-y-2 pt-1">
            <span className="block h-3 w-40 animate-pulse rounded-full bg-ink-100" />
            <span className="block h-3 w-full max-w-md animate-pulse rounded-full bg-ink-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
