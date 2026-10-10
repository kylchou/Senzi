# AI research assistant: design (not built yet)

This feature lets analysts ask questions about their research in plain language and get answers built only from data they're allowed to see, with every claim cited. It's planned as its own assignment: the design is here, and nothing is built yet.

## What it does

- **Questions it answers:** an analyst asks something on a study page or the comparison page. For example: "Why did the YES share for Acme's Series B question move this week?", "Summarize what's known about Lumen Grid's financing", "Which of my firm's open questions have the thinnest participation?"
- **What it may use:** the same approved data the page already shows that analyst:
  - study fields (question, criteria, context, baseline and methodology)
  - cited sources
  - market estimates and history (opening baseline, community allocation share and calibrated probability, kept separate)
  - resolved outcomes with their evidence
  - verified startup facts and news
- **Every claim is cited.** A sentence that cites nothing is shown as "not from your data".
- **What it never does:** browse the web, use another firm's private studies, notes or reports, give investment advice, or present the allocation share as a probability.

## Data boundary

The assistant gets no tools and no database access. The server collects the context in advance with the existing permission-checked services, then sends that fixed bundle to the model:

| Context | Source (already permission-checked) |
|---|---|
| Study | `studies.get(ctx, id)`. Limited viewers get the redacted view, never notes or participants. |
| Private notes | `studies.listNotes(ctx, id)`, only when `canViewPrivate` |
| Estimates and history | `forecasting.getEstimates` / `getHistory` for markets the study links to |
| Comparison | `compare.compare(ctx, ids)` |
| Facts and news | Sahil's public read layer (`lib/discovery`, `lib/news`): published, with verification status |

Because the bundle is built per request from these calls, the model can't see anything the analyst couldn't open themselves. Organization isolation is still enforced by the same server-side checks as everywhere else.

## How citations work

Each piece of context is sent as a **document content block with citations enabled**. Custom-content documents use one block per fact or source, so citations point at the exact block (`content_block_location`). Each block is labeled with what kind of information it is, so the model and the UI can keep these apart:

- **Verified fact:** admin-verified startup facts and resolution evidence.
- **Reported:** unverified news and cited sources.
- **Community estimate:** allocation share, opening baseline, and calibrated probability, each labeled as itself.
- **Firm note:** private notes, shown only to the firm.

The response arrives as text blocks carrying `citations` arrays. The UI renders each citation as a link back to the study section, source URL, or market. Structured outputs (`output_config.format`) can't be combined with citations, so the answer stays as prose.

## Model and API

- **SDK:** `@anthropic-ai/sdk` (official TypeScript SDK). It's a new dependency, which needs Kyler's approval.
- **Model:** `claude-opus-5-5`, with adaptive thinking (the default on this model). Set effort explicitly, starting at `medium`; tune it per route once there's an eval.
- **Streaming:** use `client.messages.stream(...)` with `.finalMessage()` so long answers don't hit request timeouts. The route handler can stream partial text to the browser.
- **Refusals:** check `stop_reason` before reading content, and handle `"refusal"` with a plain message to the user.
- **Prompt caching:** keep the system prompt (rules about the three measurements, citation requirements, no advice) frozen and first, and put a `cache_control` breakpoint after it. Per-request context and the question come after the breakpoint, so they never invalidate the cached prefix. Check `usage.cache_read_input_tokens` to confirm caching works.
- **Server-only:** calls happen in a route handler (`app/api/vc/assistant/route.ts`), never in the browser. Rate-limit per user, and record each question with `recordAudit` (question text and study id, not the answer).

## Data retention and confidentiality

- Firm notes and private study details would go to Anthropic's API. Before building, the team should confirm the organization's data-retention settings with Anthropic, and decide whether notes are sent at all. A safe first version can leave notes out.
- Some models require 30-day retention and aren't available under zero data retention (for example, the Fable tier). Stay on a model the org's retention settings allow.
- Don't send material nonpublic information. The assistant only sees what the platform already stores, which is meant to be public information plus firm notes, and the UI should repeat the disclaimer.

## Open decisions

1. Approve adding `@anthropic-ai/sdk` and an `ANTHROPIC_API_KEY` secret (Kyler).
2. Decide on data retention, and whether firm notes may be included.
3. Choose where it lives first: the study page, the comparison page, or both.
4. Build a small eval before launch: around 30 real analyst questions with expected citations, graded for citation accuracy and for never calling the allocation share a probability.
