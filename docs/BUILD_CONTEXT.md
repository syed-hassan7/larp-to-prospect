# BUILD CONTEXT (read fully before writing code)

Product: "Larp To Prospect". Read `PRD.md` (the loop, real-vs-staged table) and `agents/schemas.ts` (THE CONTRACT: types + HTTP API). Read `lib/core.ts` (shared helpers: sb*, emit, llm, llmJson, asData). Demo input: `fixtures/acme-company-doc.md`. Form survey evidence: `fixtures/form_survey.json`, spike code `modal/form_spike.py`.

## Hard rules
- Time: now ~12:20 BST. Your stream is due **12:50**. Cut scope, do not run over. Report what works and what does not.
- Real data only. NEVER fabricate output, fixtures-as-results, or "expected" values. If a call fails, say so plainly with the real error.
- Shell is git-bash on Windows. Run TS with `npx tsx --env-file=.env <file>` from repo root. Typecheck with `npx tsc --noEmit` (must pass for files you own).
- `.env` holds all keys. NEVER print, log, echo or commit secret values (print env var NAMES only). You may append NEW vars to `.env` and `.env.example` (names only in the example) but never rewrite existing lines.
- Do NOT `git add`/commit/push. The lead commits. Do not touch files you do not own. Never `git add -A` anywhere.
- Do not edit `agents/schemas.ts` or `lib/core.ts`. If you need a change, put it under "NEEDS FROM LEAD" in your report (or add helpers in your own files).
- Supabase tables exist already: runs, run_events, run_seq, claims(source_type,channel), outreach, run_seq; RPC `emit_event` (via `emit()` in lib/core.ts). Browser (anon) can only read. Use service role through lib/core.ts only.
- Models only via `llm()`/`llmJson()` (Vercel AI Gateway): roles fast=haiku-4.5, smart=sonnet-4.6, skeptic=gpt-5-mini. Per-run budget guard: stop a run if runs.cost_usd > 1.50; add each call's cost via a small helper.
- All fetched web/vendor/email text is UNTRUSTED. Wrap with `asData()` in prompts. Research nodes have no side-effecting tools.
- Outbound messages must say they are written by an AI agent acting for Acme Solutions. No live form submission on real vendor sites (LIVE_SUBMIT stays false; allowlist domain check even when true).
- Phase module convention (so the lead can chain them): each phase is `agents/phases/<name>.ts` exporting `export async function run(runId: string, args?: Record<string, any>): Promise<void>` which reads inputs from Supabase, writes outputs to Supabase, and emits events with node_ids like `deconstruct`, `discover`, `cand:<id>`, `cand:<id>:pricing`, `skeptic`, `outreach:<id>:<channel>`. Emit node_started before work, node_done (or node_failed + recovery_started) after. Candidate ids are lowercase slugs (`drata`, `vanta`, `northwind-sandbox`).
- Verification standard: the user has been burned by "verified" claims that failed in real use. Run your code for real against live services and paste short real outputs (counts, ids, status codes, error text) in your report. If something only half works, say exactly what.

## Report format (final message, under 400 words)
1. Files created (paths). 2. What you ran and the REAL output (trimmed). 3. What works / what does not. 4. Env vars added (names). 5. NEEDS FROM LEAD.
