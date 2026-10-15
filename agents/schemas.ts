// CONTRACT. Every stream (research, outreach, voice, UI) imports from here. Change only with the lead's say-so.

export type NodeState = 'idle' | 'running' | 'done' | 'failed' | 'recovering';

export type EventType =
  | 'node_started' | 'tool_call' | 'node_failed' | 'recovery_started' | 'node_done'
  | 'claim_added' | 'claim_rejected' | 'skeptic_verdict' | 'gap_found'
  | 'outreach_planned' | 'outreach_filled' | 'outreach_sent' | 'outreach_blocked' | 'vendor_reply'
  | 'run_parked' | 'run_resumed' | 'deck_ready' | 'voice_turn' | 'cost_tick';

export interface RunEvent {
  id: number; run_id: string; seq: number;
  node_id: string;            // e.g. orchestrator, deconstruct, discover, cand:drata, cand:drata:pricing, skeptic, outreach:drata:form, deck
  parent_id: string | null;
  type: EventType; payload: Record<string, unknown>; ts: string;
}

export type RunStatus = 'queued' | 'researching' | 'skeptic' | 'outreach' | 'awaiting_vendor' | 'rescoring' | 'deck_ready' | 'done' | 'failed';

export interface CompanyProfile {
  company: string; one_liner: string; need: string;
  stack: string[]; budget_cap_gbp: number | null; deadline_days: number | null;
  hard_constraints: { id: string; text: string; field: ClaimField }[];
  soft_prefs: string[]; out_of_scope: string[];
  contact: { name: string; role: string; email: string };   // used for outreach, from doc or env
  search_plan: string[];                                    // queries for discover
}

export type ClaimField = 'pricing' | 'data_residency' | 'soc2_type2' | 'integration_aws' | 'integration_github' | 'integration_okta' | 'auditor_marketplace' | 'sentiment' | string;
export type Channel = 'web' | 'form' | 'email' | 'call';

export interface Claim {
  run_id: string; candidate_id: string; field: ClaimField; value: string;
  source_url: string; quote: string;      // web claims: quote MUST be a verbatim substring of fetched text (checked in code)
  confidence: 'high' | 'low'; source_type: 'web' | 'vendor_reply' | 'call'; channel: Channel;
}

export interface Candidate { id: string; name: string; url: string; why: string }

export type Cell = 'pass' | 'fail' | 'unknown';
export interface Verdict {
  candidate_id: string; verdict: 'qualified' | 'disqualified' | 'unverified';
  cells: Record<string, { cell: Cell; claim_ids: number[]; note?: string }>;   // keyed by hard_constraint id
  disqualified_because?: string; risks: string[]; score: number;
}

export interface Gap {
  candidate_id: string; field: ClaimField; why_it_matters: string;
  flips_verdict: boolean; best_channel: Exclude<Channel, 'web'>;
}

export interface Outreach {
  id?: number; run_id: string; candidate_id: string; gap_field?: string;
  channel: 'form' | 'email' | 'call'; target?: string;
  status: 'planned' | 'filled' | 'submitted' | 'sent' | 'replied' | 'failed' | 'blocked';
  message?: string; screenshot_url?: string; reply_text?: string; sandbox: boolean; error?: string;
}

export type SlideKind = 'verdict' | 'fit_matrix' | 'disqualified' | 'gaps_closed' | 'evidence' | 'risks' | 'next_steps' | 'outreach';
export interface Slide { id: string; kind: SlideKind; title: string; body: unknown; narration: string; audio_url?: string }
export interface Deck { run_id: string; version: number; slides: Slide[] }

// HTTP API (Vercel). All return JSON. Browser only calls start/ask/act; phases are internal (header x-internal-key).
// POST /api/run/start        {doc_text, inject_failure?, live_submit?}  -> {run_id}
// POST /api/run/phase        {run_id, phase}                           (internal)
// POST /api/ingest           {run_id, candidate_id, channel, from, text, sandbox?}  -> wakes parked run (n8n + sandbox vendor + call webhook)
// POST /api/ask              {run_id, question, transcript?}           -> {answer_text, patch?: Slide[], filters?}
// POST /api/act              {run_id, action:'book_demo'|'send_outreach', candidate_id, confirmed:true}
// POST /api/voice/call       {run_id, to_number}                       -> {conversation_id}   (ElevenLabs outbound via Twilio)
// POST /api/voice/webhook    ElevenLabs post-call -> stores transcript as voice_turn events
// GET  /vendor-sandbox       Northwind Comply: real HTML form; submit -> /api/vendor-sandbox/submit -> Claude-as-rep replies via /api/ingest in ~30s
