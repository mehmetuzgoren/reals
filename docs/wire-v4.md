# Reals v4 wire contract

These exact shapes were published by the backend owner on November 15, 2026 for the eight-screen mock extension. They are an implementation contract, **not deployed behavior**: the live checkpoint remains v3 at `a48095d`. A ready v4 source/deployment and matching native artifact are still required. Existing Convex Auth, nullable envelopes, receipt rules and media grants remain unchanged.

## Upload and audience

Mutation `uploads:begin({ requestId, kind, roundId, optionId, originalId, audience? })` keeps both nullable fields required:

- Original: chosen `optionId`, `originalId: null`, optional `audience: "friends" | "public"`, default friends.
- Reply: `optionId: null`, parent `originalId`, **omit audience**. Supplying it is `INVALID_ARGUMENT`; it inherits the parent.
- Audience is immutable in the intent and published original. Reusing a request ID with a different audience is `CONFLICT`.

Return: `{ uploadId, uploadUrl, expiresAt, minDurationMs: 3000, maxDurationMs: 15000, maxBytes: 8388608 }`. Finalize/status/receipt shapes do not change. No client-supplied duration or verification metadata is trusted.

## Summary additions

All existing v3 summary fields remain required. `PublicProfile` stays `{ id, username, displayName, avatar: { url } | null }`. IDs are strings; times/durations are milliseconds.

| Summary | Additional required fields |
| --- | --- |
| Original | `audience: "friends" | "public"`, `likeCount: number`, `viewerLiked: boolean`, `visibleCommentCount: number`, `battle: { battleId: string, opponent: PublicProfile } | null` |
| Reply | `audience: "friends" | "public"`, `likeCount: number`, `viewerLiked: boolean`, `visibleCommentCount: number` |

Missing legacy stored audience means friends, never public. This storage migration rule does not make returned DTO fields optional. Adopt a ready head's exact serializers before extending the strict v3 probe.

## Feed and visibility

Query `takes:forYou({ roundId, cursor: string | null, limit: number })` returns `{ items: OriginalSummary[], nextCursor: string | null }`, newest first with stable ties, at most eight per page. Only public originals, never the viewer's own. A locked viewer gets exactly `{ items: [], nextCursor: null }`, as for friends feed.

`takes:feed` remains the viewer's own/approved friends' originals. Feed cursors are opaque visible-result IDs; restart after invalidation by a social change. `takes:detail`, `replies:list` and media grants/bytes must authorize the same audience. Public viewers still need a same-current-round receipt and no block either way with each visible author. Friends content retains parent-first friendship/intersection rules. Public access never authorizes a friends-only object.

## Likes and comments

| Function | Kind / exact result |
| --- | --- |
| `likes:toggle({ contentId, kind })` | Mutation → `{ liked: boolean, likeCount: number }` |
| `comments:list({ contentId, kind, cursor, limit })` | Query → `{ items: Comment[], nextCursor: string | null }` |
| `comments:create({ contentId, kind, text })` | Mutation → `{ commentId: string }` |
| `comments:delete({ commentId })` | Mutation → `{ ok: true }` |
| `reports:create({ contentId: commentId, kind: "comment", reason })` | Existing mutation → `{ id }` |

`kind` is `"original" | "reply"` except the explicit comment report. A Comment is `{ commentId, author: PublicProfile, text, createdAt, viewerCanDelete: boolean }`. Comment pages are oldest first, at most 50 visible items. Text is trimmed plain text, 1–300 characters; at most 20 creations per user per 60-second window, unaffected by deleting comments. Only commenter or content author can delete.

Likes require current content access, with one transactional like per person/item and no liker-list endpoint. Comment lists/counts filter content access, commenter availability and blocks before counting/pagination. Friends comments also require the author/commenter friendship intersection, including the relationship between those two people; participant exceptions do not bypass it or a reply's parent.

## Battles and deletion

Query `battles:get({ battleId })` returns `{ battleId, roundId, left: OriginalSummary, right: OriginalSummary, leftVotes, rightVotes, viewerVote: "left" | "right" | null, viewerCanVote: boolean }`.

Mutation `battles:vote({ battleId, side: "left" | "right" })` returns `{ leftVotes, rightVotes, viewerVote: "left" | "right" }`. Both public sides must be visible. Inaccessible/deleted is `NOT_FOUND`; an author vote is `FORBIDDEN`. A viewer has one changeable vote.

Pairing occurs atomically when a public original publishes: oldest unpaired public original in that round with another author, another option and no block between authors. Earlier publication is left. There is no create-battle endpoint, friends battle or ranking.

Deleting either original removes battle/votes and sets the surviving original's `battle` to null. Content deletion cascades its likes/comments and a deleted parent's replies/interactions. Account deletion also removes its authored likes/comments/votes elsewhere and battles. Original deletion preserves its successful receipt; account tombstone/session-revocation rules remain unchanged.

See the [privacy rules](security.md), [acceptance matrix](../verification/acceptance.md) and [verification status](verification-status.md). Published shapes alone prove no implementation, migration, hosted acceptance or rendered screen.
