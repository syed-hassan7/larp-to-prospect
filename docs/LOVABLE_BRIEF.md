# Lovable brief v2 (paste this INSTEAD of the earlier one)

Read /DESIGN.md and /PRD.md in the connected repo first. Follow DESIGN.md exactly: warm paper case-file look, Newsreader + IBM Plex Mono,
one alarm colour, no gradients/glow/blur/shadows/emoji/rounded cards. It must NOT look like a generic dark AI dashboard.
Stack: Vite + React + TypeScript + Tailwind + React Flow + Supabase JS. Touch only /src. No backend code.
Types are in /agents/schemas.ts: import or copy them to src/lib/types.ts verbatim.

Screens
1. Intake: big serif headline "Hand us the brief. We'll do the prospecting." Drop zone (.md/.txt/.pdf) or paste, button "Load Acme Solutions sample",
   toggles: "Inject a failure (demo)" and "Allow live submit (off)". Primary button "Open the case".
2. Case view, three columns + bottom timeline:
   - Left: event ledger (mono rows: seq, node, verb, detail).
   - Centre: React Flow board. Nodes: Brief > Deconstruct > Discover > one group per candidate (Pricing, Compliance, Integrations, Sentiment) > Skeptic >
     one Outreach node per top candidate with channel sub-nodes (Form, Email, Call) > Parked (status "waiting on vendor", shows countdown/real elapsed) > Deck.
     States per DESIGN.md (idle/running bar sweep/done/failed hatch/recovering dashed ochre edge).
   - Right: inspector for selected node: tool calls, claims as receipt strips (quote, source domain link, channel tag, time), errors, outreach screenshot (click to enlarge), vendor reply text.
   - Bottom: replay scrubber with ticks; failures as alarm ticks; play/pause, 1x/4x.
3. Fit matrix (also reachable as slide 2): candidates x hard constraints. Cells PASS / FAIL / UNKNOWN. UNKNOWN cells dashed ochre with an "asking vendor" tag. When a
   vendor_reply event arrives the cell re-stamps with a thud animation and shows the reply quote with [EMAIL]/[FORM]/[CALL] tag.
4. Deck: full-screen 16:9 slides (arrow keys): Verdict, Fit matrix, Disqualified with receipts, Gaps closed (before/after per vendor), Risks, Next steps, Outreach drafts with
   "Approve and send". Bottom bar: ANALYST · LIVE waveform line, mic push-to-talk, "Call me" button (POST /api/voice/call with a phone number input).
   Embed the ElevenLabs conversational AI web widget/SDK using VITE_ELEVENLABS_AGENT_ID (leave the id empty-safe).

Data: pure reducer over append-only `run_events` (src/lib/reduce.ts), Supabase Realtime filtered by run_id + history load on mount (powers replay). Also read `runs`, `claims`, `outreach`
tables. src/fixtures/events.ts: a realistic 100-event sample including a failure, a recovery, a gap_found, run_parked and a vendor_reply, used when VITE_USE_FIXTURE=true.
Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_ELEVENLABS_AGENT_ID, VITE_USE_FIXTURE. Start a run by POSTing {doc_text, inject_failure, live_submit} to /api/run/start.
