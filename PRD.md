# Larp To Prospect — PRD v2 (supersedes SPEC.md where they differ)

## 1. The idea in one breath
A founder drops in a company info doc. Agents find vendors, prove what they can from public pages, **list what the public web cannot tell
them (the "gaps"), then go get those answers the way a human would: fill the vendor's demo form, email the right person, take the
reply or the call, feed it back.** The run does not end when the research ends. It parks, waits for the vendor, wakes up on the reply,
re-scores, and calls the founder with the verdict.

Tagline: *Research is the easy half. Prospecting is getting the answers nobody publishes.*

## 2. Why this beats one Claude/Perplexity prompt (the judge answer)
Measured today, on the Acme brief: public pricing text appears on Drata and Secureframe only. Vanta, Sprinto and Thoropass scrape fine
(138k / 23k / 32k chars) but contain **no price**. A chat model fills that hole with a guess. We (a) mark it unknown, (b) ask the vendor,
(c) put the vendor's own answer into the evidence ledger with channel + timestamp. Single prompts cannot wait three days and resume.

## 3. Customer, problem, why now
Seed–Series B founder / head of eng with no procurement team, buying under deadline pressure (Acme: SOC 2 in 90 days for two enterprise deals).
Pain: pricing behind "contact sales", dealbreakers found after the demo, 6–10 hours of tabs + 5 forms + follow-ups. Why now: agents can browse,
call, and wait.

## 4. The loop (this is the product)
```
doc -> DECONSTRUCT -> DISCOVER -> RESEARCH x N (4 specialists each, quote-verified claims)
   -> SKEPTIC (other model family): verdict per vendor + GAP LIST (decision-critical unknowns)
   -> OUTREACH per top-3 vendor, per gap:   form  |  email  |  voice
   -> PARK  (run.status = awaiting_vendor, durable in Supabase)
   -> INGEST (reply email / form confirmation / call transcript)  -> new claim {source: vendor, channel, ts}
   -> RE-SCORE -> DECK PATCH -> VOICE BRIEFING (phone/browser) -> founder decision -> ACT (book demo / send redline)
```
A gap is only chased if it can flip a verdict (e.g. price unknown and plausible range straddles the £15k cap). No decorative outreach.

## 5. Honest scope: what is real vs staged (say this on camera)
| Piece | Demo mode | Why |
|---|---|---|
| Research, claims, quote checks, skeptic, deck | **Real**, live web, any doc | core |
| Form discovery + filling on real vendor sites | **Real fill, stops before Submit**, screenshot as proof | Acme is fictional; submitting fake leads to real sales teams is deceptive and wastes their time |
| Form submit + vendor reply | **Sandbox vendor "Northwind Comply"** we host (real form, real inbox, Claude plays the rep, replies in ~30s, labelled sandbox) | real replies take days; this shows the loop closing in-demo |
| Real replies from real vendors | **Works if a real customer runs it**: n8n inbound webhook -> /api/ingest wakes the parked run | this is the long-running story |
| Phone | ElevenLabs agent **calls the founder** with the verdict, takes interruptions, voice command triggers ACT | calling vendors cold with an AI voice is regulated (UK PECR/Ofcom, AI disclosure) — not doing it |
Live-submit is gated: `LIVE_SUBMIT=false` default plus a domain allowlist. Every outbound message states it is an AI agent acting for the named company.

## 6. Architecture (small on purpose)
```
Lovable UI (React Flow + deck)  <-realtime-  Supabase (runs, run_events, claims, outreach)  <-write-  Vercel /api (TS phases)
                                                                                                   \-> Modal fn: fill_form (Playwright+Claude)
                                                                                                   \-> AI Gateway: Claude + GPT-5 skeptic
n8n: send email / inbound reply -> /api/ingest          ElevenLabs Agent (one agent, two transports: browser widget, Twilio phone)
```
- **State machine**: `runs.status`: queued, researching, skeptic, outreach, awaiting_vendor, rescoring, deck_ready, done, failed.
  Each phase = one Vercel function, <=120s, idempotent, re-entrant. Fan-out = parallel invocations. No long-lived workers.
- **Event log** (`run_events`) is the single source for graph, replay, inspector. UI = reducer.
- **Claims** carry `source_type`: web | vendor_reply | call. Web claims need a verbatim quote; vendor claims keep the raw message id.
- **Modal earns its place**: Vercel cannot run a browser. `fill_form(url, profile)` = Playwright, pull form fields from DOM,
  Claude maps profile -> fields (JSON), fill, screenshot -> Supabase Storage, return {status, fields, screenshot}. Captcha / iframe form /
  no form -> `node_failed` -> recovery: email the address on the contact page via n8n, else mark channel dead. Visible in the graph.
- **Models**: Haiku 4.5 extraction, Sonnet 4.6 deconstruct/deck/outreach copy, GPT-5-mini skeptic (cross-family). Gateway balance $99.99.
  Per-run guard: abort at $1.50.
- **ElevenLabs**: ONE conversational agent. Server tools: `get_deck_state`, `refilter(filters)`, `act(vendor, action)`. Browser widget first;
  Twilio phone is only a transport swap (see 8). TTS pre-render per slide stays as fallback.

## 7. Gap list = the bit judges will remember
Skeptic emits `gaps[]`: {vendor, field, why_it_matters, flips_verdict:boolean, best_channel}. UI shows gaps as amber tags on the fit matrix;
when a reply lands the tag flips to a stamped value with the vendor's quote and the channel icon. The matrix visibly changes mid-demo.

## 8. Phone (Twilio x ElevenLabs): in, but gated
Status today: ElevenLabs Creator tier, agents API reachable, 0 agents, 0 numbers. **Twilio account does not exist yet.**
Gate: Twilio number imported into ElevenLabs by **12:45 BST**, else cut to browser widget (same agent, zero rework).
Facts to plan around: Twilio trial can only call numbers you have verified (yours) and plays a trial preamble first; a US number is fine for
calling a UK mobile and avoids UK regulatory bundles. Flow: `POST /v1/convai/twilio/outbound-call` with agent_id, agent_phone_number_id, to_number.
Call script: "Acme's vendor search finished. Drata and Sprinto qualify; Vanta is ruled out, price above cap. Want the detail?" -> user interrupts
("UK-only under 50 people?") -> `refilter` tool -> deck updates on screen while the call continues -> "book the Drata demo" -> `act`.
Post-call webhook stores transcript as an event.

## 9. Design: "case file", not dashboard (see DESIGN.md)
Warm paper, ink, one alarm colour. Verdict stamps, receipts as torn quote strips, graph as thin ink lines on a grid. Nothing glows.

## 10. Cut list (no over-engineering)
Cut: Modal beyond fill_form, Lightdash/Miro/Port/Stripe, real vendor calling, multi-user auth, PDF parsing beyond text, vendor discovery
beyond 6 candidates, ElevenLabs Agents knowledge base. Maybe-if-time: Port/Lightdash scorecard (no).

## 11. Build plan (BST, now ~11:45; FREEZE 13:40)
| When | Stream | Owner |
|---|---|---|
| 11:45 | contract committed (types, tables), Lovable brief + design out | me / you paste in Lovable |
| 11:45–12:50 | **A** core lib + deconstruct/discover/research fan-out + quote check + skeptic + gaps | builder 1 |
| 11:45–12:50 | **B** Modal fill_form + sandbox vendor site + /api/ingest + n8n send/inbound | builder 2 |
| 11:45–12:50 | **C** ElevenLabs agent + tools + /api/ask + Twilio import + outbound call | builder 3 |
| 11:45–13:00 | **D** Lovable UI wired to realtime | Lovable + you |
| 12:50–13:25 | integrate: outreach phase, park/resume, rescore, deck JSON, narration | me |
| 13:25–13:40 | two full live runs, record fallback replay | me + you |
| 13:40 | FREEZE. 14:00–14:40 record. 14:40–15:00 README + submit | you |
Streams talk only through `agents/schemas.ts`, Supabase tables, and `/api/*` routes. If one stream slips past 12:50 it is cut, not extended.

## 12. Risks, ranked
1. **Integration at 12:50** (4 streams). Mitigation: fixtures per stream, contract-first, cut rule above.
2. **Form filling on real sites** (HubSpot iframes, captchas, consent walls): expect ~50% success; recovery path is the feature. Test 5 real vendor forms by 12:20; show real screenshots even for fails.
3. **Twilio onboarding delay**: gate at 12:45.
4. **Run latency** (~5 min): progressive UI; cap at 4 candidates; pre-warmed fallback run.
5. **Prompt injection from vendor pages/replies**: content is delimited data; no side-effecting tools in research nodes; `act` needs founder confirmation.
6. **Deception optics**: sandbox vendor is labelled; no unlabelled fake leads to real companies; AI disclosure in every message.
