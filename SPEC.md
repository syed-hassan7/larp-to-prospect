# Larp To Prospect — Spec v1 (locked 10:35 BST, deadline 15:00, record 14:00)

## One-liner
Drop in a Company Info Doc. A swarm of Claude agents finds real candidates, verifies each claim against live sources
(with receipts), disqualifies bad fits, drafts outreach, and briefs you by voice on a visual decision deck you can interrupt.

## Wedge (decision): BUY-SIDE vendor selection for startups
Customer: seed–Series B startup with no procurement team that must pick a vendor (compliance, observability, CRM, ...).
Pain: pricing hidden behind "contact sales", stack/compliance mismatches found after the demo call, ChatGPT answers = SEO fluff.
Why not one prompt: parallel per-vendor verification, claim-level citations checked in code, a skeptic that disqualifies
with receipts, replayable run, and an action at the end (outreach out the door).
Why buy-side not sell-side lead-gen: constraints (price, residency, integrations) are verifiable from public pages; sell-side
is crowded (Clay/Apollo) and unverifiable in a day.

## Demo input: "Acme Solutions" Company Info Doc
Fictional 28-person London B2B SaaS. Need: SOC 2 compliance automation. Stack: AWS, GitHub, Okta, Linear, Slack.
Hard constraints: UK/EU data residency, budget cap £15k/yr, native GitHub + AWS integrations, audit-ready within 90 days.
Soft: transparent pricing, auditor marketplace, good support sentiment. Candidates are NOT in the doc — agents discover them.
Judges can drop in any other doc (the doc schema is generic).

## Architecture
```
Lovable UI (Vite/React/React Flow)  <-- Supabase Realtime (run_events) --  /api/* on Vercel
 upload doc, live node graph,                                              phase-chained functions
 replay scrubber, voice deck                                               state ONLY in Supabase
```
Phases (each its own invocation, <=120s, resumable, fan-out = parallel invocations):
1. `deconstruct`  Sonnet -> CompanyProfile JSON {needs, hard_constraints[], soft_prefs[], stack, budget, search_plan}
2. `discover`     Tavily + Firecrawl search + HN -> 5–6 candidates (+ why-considered)
3. `research` x N (one invocation per candidate; 4 specialist nodes inside, Promise.all):
   pricing | security/compliance+residency | integrations/docs | sentiment (HN Algolia, GitHub issues, Tavily reviews)
   Each node emits Claims: {candidate, field, value, source_url, quote}. Quote must be a literal substring of the fetched
   page text — verified in code, else the claim is dropped. (kills hallucination; this is the "Real Output" proof)
4. `skeptic`      different model family via AI Gateway (OpenAI) if key lands, else Claude with adversarial prompt.
   Checks the claim ledger vs hard_constraints -> verdict per candidate: qualified / disqualified (receipt) / unverified.
   May emit up to 2 `reverify` tasks back into phase 3 (bounded loop). Unknown pricing = risk flag, never guessed.
5. `deck`         Sonnet -> Deck JSON (typed slides, not generated HTML): Verdict, Fit matrix, Disqualified-with-receipts,
   Evidence, Risks, Next steps, Outreach. Per-slide narration script. ElevenLabs TTS pre-rendered per slide in parallel.
6. `act`          Outreach drafts per finalist. "Send" -> n8n webhook (demo: delivers to our own inbox, labelled with intended recipient).

### Error recovery (real, visible)
Fetch chain per URL: Firecrawl -> Jina Reader (keyless tier) -> Tavily extract -> search-snippet-only (claim flagged low-confidence).
Every hop emits `node_failed` + `recovery_started{from,to,reason}` events. Timeouts: 20s/hop, 1 retry w/ backoff.
Demo toggle "inject failure" kills the primary source for one node so the recovery is guaranteed on camera
(UI labels it as injected — don't pass it off as organic).

### Voice Q&A
v1: push-to-talk -> browser Web Speech API (free) -> /api/ask -> Claude with the claim ledger + `refilter` tool ->
deterministic re-score over existing claims -> deck patch -> ElevenLabs TTS answer. If the new filter needs data not in
the ledger, it spawns a mini re-research on the missing field (events show it).
Stretch only after everything else works: ElevenLabs Agents SDK with client tools.

### Telemetry / replay
`run_events(id, run_id, seq, node_id, parent_id, type, payload jsonb, ts)` append-only. Types: node_started, tool_call,
node_failed, recovery_started, node_done, claim_added, claim_rejected, skeptic_verdict, deck_ready, cost_tick.
UI = pure reducer over events. Replay = same reducer with a seq scrubber. Judges can inspect any node's tool calls + claims.

## Models
Haiku-class for extraction nodes, Sonnet for deconstruct/skeptic/deck. One `model(role)` fn; flips to AI Gateway slugs when the
key exists. Hard per-run budget guard (cost_tick events; abort at ~$1.50). Verify live model IDs by curl before hardcoding.

## Sponsor usage (what's in vs cut)
IN: Anthropic (all reasoning) · ElevenLabs (TTS + voice Q&A) · Lovable (UI shell) · Vercel (hosting + Gateway) ·
Supabase (events/state/realtime) · OpenAI via Gateway (cross-model skeptic) · n8n (one outbound webhook, last priority).
CUT: Modal (Vercel fan-out already parallel; no heavy compute needed), Lightdash, Miro, Port, Stripe.

## Schedule (BST)
10:30–11:00 wiring: Supabase project + schema, ElevenLabs credit redeem, Vercel link, Lovable kickoff w/ event schema + fixture
11:00–12:00 backend: deconstruct → discover → one candidate researched end-to-end w/ verified claims (terminal)
12:00–12:45 fan-out x N, recovery chain, UI wired to realtime (Lovable output merged)
12:45–13:15 skeptic + reverify loop, deck JSON + slides rendering
13:15–13:40 TTS narration + voice Q&A + outreach/n8n
13:40–14:00 FREEZE. 2 full live runs; save best as labelled "recorded run" fallback
14:00–14:40 record demo (backup: replay mode) · 14:40–15:00 README, submit. No features after 13:40.

## Risks -> mitigation
- Scraper blocked/thin -> fallback chain above (a feature, not a bug)
- LLM invents facts -> quote-substring check; unknown stays unknown
- Prompt injection from scraped pages -> pages are data in delimited blocks; research nodes have no side-effecting tools
- Run too slow -> per-candidate fan-out, 20s hop timeouts, target <4 min; progressive UI so the graph is alive from second 1
- Lovable overwrites backend -> backend only in /api and /agents; Lovable touches /src only
- Lovable can't sync to an existing non-empty repo (verify) -> let Lovable create the repo, or delete the empty one first
- Live demo failure -> pre-recorded run replay through the same UI, clearly labelled
- ElevenLabs free tier = 10k chars (~2 runs) -> redeem pack credit BEFORE building voice

## Repo layout
/src (Lovable) · /api/run/{deconstruct,discover,research,skeptic,deck,act}.ts · /api/ask.ts · /agents/{models,fetchChain,claims,schemas}.ts
/fixtures/acme-company-doc.md, /fixtures/replay.json · /supabase/schema.sql · .env.example
