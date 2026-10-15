Build "Larp To Prospect": an autonomous vendor-prospecting agent. A founder hands over a company brief; a swarm of agents finds vendors, verifies every claim against live web pages with verbatim quotes, fills vendor demo forms and emails vendors to close the gaps nobody publishes (like price), waits for replies, re-scores, and briefs the founder with a narrated deck and a voice analyst. The UI shows that work happening live, with receipts.

Stack: Vite + React + TypeScript + Tailwind + React Flow (@xyflow/react) + @supabase/supabase-js + @elevenlabs/react. Frontend only. No backend code, no Supabase edge functions, no Lovable Cloud backend.

## Design: "case file" (follow exactly; this must NOT look like a generic dark AI dashboard)
An investigator's case file. The value is receipts, so the UI is made of evidence: stamped verdicts, quote strips with sources, a board of threads.
Tokens:
--paper #F4F0E6 (page) · --card #FBF9F3 (panels) · --ink #14130F (text, lines) · --ink-2 #5C5849 (secondary) · --rule #CFC8B5 (1px dividers) · --alarm #D63A1F (disqualified/failed/errors, the ONLY loud colour) · --ok #2F6B3F (qualified, muted forest) · --wait #B7791F (unknown / awaiting vendor, ochre).
Rules: light theme only. No gradients, glow, blur or drop shadows (raised items use a 1px ink offset border). Border radius max 2px. No emoji, no icons-in-circles, no avatars.
Type: Newsreader (Google Fonts, serif, weight 500) for headlines and verdicts; body Newsreader 17px. IBM Plex Mono 12-13px for data and labels; labels uppercase with 0.06em tracking. Tabular numerals. Sentence case except mono labels.
Components:
- Verdict stamp (hero element): rotated -2deg, 2px border, mono caps QUALIFIED / DISQUALIFIED / UNVERIFIED in ok / alarm / wait colour.
- Receipt strip: card with a perforated left edge (CSS mask), mono quote in quotes, source domain underlined and linked, channel tag [WEB] [EMAIL] [FORM] [CALL], time.
- Fit matrix: ruled table, cells read PASS / FAIL / UNKNOWN in mono (no tick icons). UNKNOWN cells: dashed ochre border + "asking vendor" tag. When answered, the cell re-stamps.
- Graph: React Flow on a faint 24px dot grid. Nodes are rectangles with 1px ink border, mono title, serif subtitle. Running = a 2px ink bar sweeping along the bottom edge (no pulse, no glow). Failed = alarm border + diagonal hatch. Recovering = dashed ochre edge. Edges 1px ink, curved.
- Event ledger: monospaced rows `seq  node  verb  detail`; new rows slide 4px and fade in.
Motion: only state changes move, 150ms linear. Stamps land with a 100ms scale 1.08 -> 1 thud. Respect prefers-reduced-motion.

## Screens
1. Intake (/): big serif headline "Hand us the brief. We'll do the prospecting." Drop zone (.md/.txt) or paste textarea, button "Load Acme Solutions sample" (fills the textarea with a short sample brief: Acme Solutions, 28-person London B2B SaaS, needs SOC 2 Type II automation, budget under £15k/yr, UK/EU data residency, native AWS + GitHub + Okta integrations). Toggle "Inject a failure (demo)" (clearly labelled). Primary button "Open the case" -> POST {doc_text, inject_failure} to `${VITE_API_BASE_URL}/api/run/start`, read {run_id}, navigate to /case/:run_id. In fixture mode, navigate to /case/fixture.
2. Case view (/case/:id): three columns + bottom timeline.
   - Left: event ledger.
   - Centre: React Flow board built FROM the events (node ids are in events; parent_id gives edges). Layout left-to-right: deconstruct > discover > one group per candidate `cand:<id>` with 4 children `cand:<id>:pricing|compliance|integrations|sentiment` > skeptic > `outreach:<id>:<channel>` nodes > a "Parked: waiting on vendor" node (shows real elapsed time since run_parked) > deck. Use dagre or a simple column layout.
   - Right: inspector for the selected node: tool calls, claims as receipt strips, errors, outreach screenshot (payload.screenshot_url, click to enlarge), vendor reply text.
   - Bottom: replay scrubber with one tick per event (failures as alarm ticks), play/pause, 1x/4x. Replay = reduce events[0..cursor].
   - Header: run status, live cost (sum of cost_tick payload.delta_usd), elapsed time, button "Open the deck" (enabled on deck_ready).
3. Fit matrix (/case/:id/matrix and also slide 2): candidates x hard constraints from the skeptic verdicts. Clicking a cell opens its receipts. When a vendor_reply event arrives, the affected cells re-stamp with the thud and show the reply quote with its channel tag.
4. Deck (/case/:id/deck): full-screen 16:9 paper slides, arrow keys to navigate. Each slide: big serif sentence title, evidence below, one idea per slide. Slide kinds: verdict, fit_matrix, disqualified (with receipts), gaps_closed (before/after per vendor), evidence, risks, next_steps, outreach (drafts with an "Approve and send" button -> POST /api/act {run_id, action:'send_outreach', candidate_id, confirmed:true}). Each slide has an <audio> from slide.audio_url with play/pause; "Play narration" autoplays through.
   Bottom bar: a plain ink waveform line labelled "ANALYST · LIVE" (mono) + a "Talk to the analyst" button that starts an ElevenLabs conversation with @elevenlabs/react `useConversation`, agentId = VITE_ELEVENLABS_AGENT_ID, dynamicVariables {run_id, company, top_pick, summary} from run state. Show live transcript lines as receipt strips. Also a text box "Ask the analyst" -> POST /api/ask {run_id, question} -> show answer_text; if `patch` (Slide[]) is returned, replace those slides by id. If the agent id is empty, hide the voice button (no crash).

## Data contract (copy into src/lib/types.ts verbatim)
```ts
export type EventType =
  | 'node_started' | 'tool_call' | 'node_failed' | 'recovery_started' | 'node_done'
  | 'claim_added' | 'claim_rejected' | 'skeptic_verdict' | 'gap_found'
  | 'outreach_planned' | 'outreach_filled' | 'outreach_sent' | 'outreach_blocked' | 'vendor_reply'
  | 'run_parked' | 'run_resumed' | 'deck_ready' | 'voice_turn' | 'cost_tick';
export interface RunEvent { id: number; run_id: string; seq: number; node_id: string; parent_id: string | null; type: EventType; payload: Record<string, unknown>; ts: string; }
export type RunStatus = 'queued'|'researching'|'skeptic'|'outreach'|'awaiting_vendor'|'rescoring'|'deck_ready'|'done'|'failed';
export type Channel = 'web'|'form'|'email'|'call';
export interface Claim { id?: number; run_id: string; candidate_id: string; field: string; value: string; source_url: string; quote: string; confidence: 'high'|'low'; source_type: 'web'|'vendor_reply'|'call'; channel: Channel; }
export interface Candidate { id: string; name: string; url: string; why: string }
export type Cell = 'pass'|'fail'|'unknown';
export interface Verdict { candidate_id: string; verdict: 'qualified'|'disqualified'|'unverified'; cells: Record<string, { cell: Cell; claim_ids: number[]; note?: string }>; disqualified_because?: string; risks: string[]; score: number; }
export interface Gap { candidate_id: string; field: string; why_it_matters: string; flips_verdict: boolean; best_channel: 'form'|'email'|'call'; }
export type SlideKind = 'verdict'|'fit_matrix'|'disqualified'|'gaps_closed'|'evidence'|'risks'|'next_steps'|'outreach';
export interface Slide { id: string; kind: SlideKind; title: string; body: unknown; narration: string; audio_url?: string }
export interface Deck { run_id: string; version: number; slides: Slide[] }
```
Payloads (treat all as optional, render defensively): node_started/node_done {label?, summary?}; tool_call {tool, url?, query?}; node_failed {error, source?, injected?}; recovery_started {from, to, reason, injected?}; claim_added {claim}; claim_rejected {field, reason, quote?}; skeptic_verdict {verdicts: Verdict[]}; gap_found {gap: Gap}; outreach_* {candidate_id, channel, status, message?, screenshot_url?, target?, sandbox?}; vendor_reply {candidate_id, channel, from, text, claims}; run_parked {waiting_on: string[]}; deck_ready {deck: Deck}; voice_turn {role, text}; cost_tick {delta_usd, total_usd}. If `injected` is true, label the failure "INJECTED (demo)".

State: the UI is a pure reducer over the append-only event list (src/lib/reduce.ts, events sorted by seq). Live mode: load history from Supabase table `run_events` where run_id = :id order by seq, then subscribe with Supabase Realtime (postgres_changes INSERT on run_events filtered run_id=eq.:id). Also read tables `runs` (id, status, candidates, verdicts, gaps, deck, cost_usd), `claims`, `outreach` with the anon key (read-only).
Fixture mode: src/fixtures/events.ts with a realistic ~100-event run for Acme (candidates vanta, drata, sprinto, scytale, northwind-sandbox) including: one injected failure + recovery, claims with real-looking quotes and source URLs, a skeptic_verdict where Vanta is unverified (pricing unknown) and one candidate disqualified, gap_found events, outreach_filled with a screenshot_url, run_parked, a vendor_reply from northwind-sandbox that turns pricing UNKNOWN -> PASS, and deck_ready with 7 slides. Fixture mode replays it on a timer so the whole UI works with no backend.

Config: create src/lib/config.ts exporting SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL, ELEVENLABS_AGENT_ID, USE_FIXTURE. Each reads import.meta.env.VITE_<NAME> and falls back to these public defaults (all are browser-safe, publishable values):
  SUPABASE_URL = "__SUPABASE_URL__"
  SUPABASE_ANON_KEY = "__SUPABASE_ANON_KEY__"
  API_BASE_URL = "https://larp-to-prospect.vercel.app"
  ELEVENLABS_AGENT_ID = "__ELEVENLABS_AGENT_ID__"
  USE_FIXTURE = true  (string "false" in VITE_USE_FIXTURE turns it off)
Keep all API calls in src/lib/api.ts and all Supabase access in src/lib/supabase.ts. Do NOT enable Lovable Cloud or connect a Supabase project; this app talks to an existing external Supabase with the anon key only.
