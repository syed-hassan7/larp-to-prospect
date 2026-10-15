// Phase: outreach. Reads runs.verdicts + runs.gaps, picks up to 3 non-disqualified candidates with gaps (northwind-sandbox always),
// asks each vendor the gap questions the way a human would: form (Modal Playwright fill) -> fallback email (n8n -> Gmail).
// Real vendors: form is FILLED + screenshotted, never submitted. Sandbox vendor: really submitted (sandbox=true), the rep replies via /api/ingest.
// Email in demo mode ALWAYS goes to the demo inbox (we must not email real vendors); the intended recipient is in the subject.
// Ends by parking the run (status awaiting_vendor) + run_parked. Re-entrant: skips (candidate, channel) pairs already attempted.
import { env, sbSelect, sbInsert, sbPatch, emit, llm } from '../../lib/core.js';
import { chargeLlm, assertBudget } from '../../lib/budget.js';
import type { Candidate, Gap, Verdict } from '../schemas.js';

const NODE = 'outreach';
export const SANDBOX_ID = 'northwind-sandbox';
export const DEMO_INBOX = 'acme.procurement.demo@gmail.com';
const MAX_VENDORS = 3;
const DEFAULT_PHONE = '+44 20 7946 0000'; // Ofcom drama-reserved range, not a real subscriber

interface RunRow {
  id: string; doc_text: string; profile: any; candidates: Candidate[] | null;
  verdicts: Record<string, Verdict> | null; gaps: Gap[] | null; status: string;
}
interface Target { cand: Candidate; gaps: Gap[]; synthetic: boolean }
type Chan = 'form' | 'email';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '');
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// ------------------------------------------------------------------ selection
export function pickTargets(run: Pick<RunRow, 'candidates' | 'verdicts' | 'gaps'>): Target[] {
  const cands = run.candidates ?? [];
  const verdicts = run.verdicts ?? {};
  const gaps = run.gaps ?? [];
  const eligible: Target[] = [];
  for (const c of cands) {
    const v = verdicts[c.id];
    if (v?.verdict === 'disqualified') continue;
    let mine = gaps.filter(g => g.candidate_id === c.id);
    let synthetic = false;
    if (!mine.length && c.id === SANDBOX_ID) {
      mine = [{ candidate_id: c.id, field: 'pricing', why_it_matters: 'Pricing is not published; UK/EU price for a 28-person team and whether the audit is bundled decide the budget cap.', flips_verdict: true, best_channel: 'form' }];
      synthetic = true;
    }
    if (mine.length) eligible.push({ cand: c, gaps: mine, synthetic });
  }
  const rank = (t: Target) => (t.cand.id === SANDBOX_ID ? 1e6 : 0) + t.gaps.filter(g => g.flips_verdict).length * 1000 + (verdicts[t.cand.id]?.score ?? 0);
  eligible.sort((a, b) => rank(b) - rank(a));
  return eligible.slice(0, MAX_VENDORS);
}

// ------------------------------------------------------------------ profile + copy
export function buildFormProfile(run: RunRow, message: string) {
  const contact = run.profile?.contact ?? {};
  const [first, ...rest] = String(contact.name || 'Priya Nair').trim().split(/\s+/);
  const m = /(\d{1,4})[- ]person/i.exec(run.doc_text || '');
  return {
    first, last: rest.join(' ') || 'Nair', email: DEMO_INBOX, company: run.profile?.company || 'Acme Solutions',
    title: contact.role || 'Head of Engineering', phone: DEFAULT_PHONE, website: 'https://acme-solutions.example',
    employees: m ? Number(m[1]) : 28, country: 'United Kingdom', message,
  };
}

const DISCLOSURE = /I am an AI agent acting for /i;

async function writeMessage(run: RunRow, t: Target, token: string | null): Promise<string> {
  const company = run.profile?.company || 'Acme Solutions';
  const p = run.profile ?? {};
  const facts = {
    company, one_liner: p.one_liner, need: p.need, stack: p.stack, budget_cap_gbp: p.budget_cap_gbp, deadline_days: p.deadline_days,
    hard_constraints: (p.hard_constraints ?? []).map((h: any) => h.text),
  };
  const questions = t.gaps.map(g => ({ field: g.field, why: g.why_it_matters }));
  const user = `Write a short message to the sales team of ${t.cand.name} (${t.cand.url}) asking for answers their public site does not give.\n\nBuyer facts:\n${JSON.stringify(facts)}\n\nUnanswered questions (gaps):\n${JSON.stringify(questions)}\n\nRules:\n- 70-120 words, plain text, no markdown, no subject line, no sign-off block beyond one closing line.\n- First sentence MUST be exactly: "I am an AI agent acting for ${company}." then continue.\n- Ask one concrete, answerable question per gap (e.g. for pricing: the UK/EU price for a 28-person team, whether the audit is bundled or extra, and what the first-year total is). Mention the facts that make the question answerable (28 staff, London, SOC 2 Type II within 90 days, UK/EU data residency, AWS/GitHub/Okta) only where relevant.\n- Ask them to reply by email with the answers; a sales call is not needed.\n- Polite, specific, no flattery, no invented facts.`;
  const res = await llm({ role: 'smart', system: 'You write concise, honest B2B procurement enquiries on behalf of a buyer. Output only the message text.', user, maxTokens: 600 });
  await chargeLlm(run.id, `outreach:${t.cand.id}`, res, 'outreach copy').catch(e => { if (/budget/i.test(String(e))) throw e; });
  let text = res.text.trim().replace(/^["']|["']$/g, '');
  if (!DISCLOSURE.test(text)) text = `I am an AI agent acting for ${company}. ` + text;
  if (token) text += `\n\n${token}`;
  return text.slice(0, 1400);
}

// ------------------------------------------------------------------ demo-page discovery (real vendors)
const KNOWN_FORMS: Record<string, string> = {
  'vanta.com': 'https://www.vanta.com/demo', 'drata.com': 'https://drata.com/demo', 'secureframe.com': 'https://secureframe.com/demo',
  'sprinto.com': 'https://sprinto.com/demo', 'hyperproof.io': 'https://hyperproof.io/request-demo/', 'scrut.io': 'https://www.scrut.io/book-a-demo',
};
async function findDemoUrl(candUrl: string): Promise<string> {
  const host = hostOf(candUrl);
  if (KNOWN_FORMS[host]) return KNOWN_FORMS[host];
  let origin: string;
  try { origin = new URL(candUrl).origin; } catch { return candUrl; }
  for (const path of ['/demo', '/request-demo', '/book-a-demo', '/get-a-demo', '/contact-sales', '/contact']) {
    try {
      const r = await fetch(origin + path, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LarpToProspect/1.0)' } });
      if (r.status === 200 || r.status === 403) return origin + path; // 403 = bot wall; the real browser may pass it
    } catch { /* next */ }
  }
  return candUrl;
}

// ------------------------------------------------------------------ channels
async function callFillForm(url: string, profile: object, liveSubmit: boolean, runId: string, candId: string) {
  const res = await fetch(env('MODAL_FILL_FORM_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': env('INTERNAL_API_KEY') },
    body: JSON.stringify({ url, profile, live_submit: liveSubmit, run_id: runId, candidate_id: candId }),
    signal: AbortSignal.timeout(165_000),
  });
  const text = await res.text();
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error(`fill_form ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok && !j.status) throw new Error(`fill_form ${res.status}: ${text.slice(0, 200)}`);
  return j as { status: 'filled' | 'submitted' | 'failed' | 'blocked'; fields: { label: string; value: string; kind: string }[]; screenshot_url?: string; error?: string; [k: string]: any };
}

async function sendEmail(to: string, subject: string, text: string): Promise<string> {
  const res = await fetch(env('N8N_SEND_EMAIL_URL'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': env('INTERNAL_API_KEY') },
    body: JSON.stringify({ to, subject, text }), signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  let j: any = {}; try { j = JSON.parse(body); } catch { /* keep raw */ }
  if (!res.ok || j.ok !== true) throw new Error(`n8n send ${res.status}: ${body.slice(0, 200)}`);
  return String(j.message_id ?? '');
}

// ------------------------------------------------------------------ per-vendor work
async function chase(run: RunRow, t: Target, existing: { candidate_id: string; channel: string; status: string }[]): Promise<{ cand: string; rows: number[] }> {
  const { cand } = t;
  const id = cand.id;
  const isSandbox = id === SANDBOX_ID;
  const run8 = run.id.slice(0, 8);
  const token = `[run:${run8}/${id}]`;
  const gapFields = t.gaps.map(g => g.field);
  const gap_field = gapFields.join(',');
  const done = (ch: Chan) => existing.some(o => o.candidate_id === id && o.channel === ch && o.status !== 'failed');
  const rows: number[] = [];

  // best_channel 'email' (or 'call', which we never do on vendors) -> email first; sandbox is always the form.
  const wantsEmailFirst = !isSandbox && t.gaps.every(g => g.best_channel !== 'form');
  const message = await writeMessage(run, t, isSandbox ? token : null);

  const doEmail = async (reason?: string) => {
    if (done('email')) return;
    const node = `outreach:${id}:email`;
    const intended = `sales@${hostOf(cand.url) || 'vendor.example'}`;
    const subject = `[to: ${intended}] ${run.profile?.company || 'Acme Solutions'} question for ${cand.name}: ${gapFields.slice(0, 3).join(', ')} ${token}`;
    const body = (message.includes(token) ? message : `${message}\n\n${token}`) + `\n\n(DEMO MODE: this email was redirected to the Acme demo inbox; intended recipient ${intended}.)`;
    const [row] = await sbInsert<{ id: number }>('outreach', { run_id: run.id, candidate_id: id, gap_field, channel: 'email', target: intended, status: 'planned', message: body, sandbox: isSandbox });
    rows.push(row.id);
    await emit(run.id, node, 'outreach_planned', { candidate_id: id, channel: 'email', gap_fields: gapFields, target: intended, delivered_to: DEMO_INBOX, subject, message: body, outreach_id: row.id, reason: reason ?? null, sandbox: isSandbox }, NODE);
    try {
      const msgId = await sendEmail(DEMO_INBOX, subject, body);
      await sbPatch('outreach', `id=eq.${row.id}&status=eq.planned`, { status: 'sent' });
      await emit(run.id, node, 'outreach_sent', { candidate_id: id, channel: 'email', target: intended, delivered_to: DEMO_INBOX, subject, message_id: msgId, outreach_id: row.id, sandbox: isSandbox }, NODE);
    } catch (e) {
      const err = (e as Error).message.slice(0, 300);
      await sbPatch('outreach', `id=eq.${row.id}`, { status: 'failed', error: err });
      await emit(run.id, node, 'node_failed', { candidate_id: id, channel: 'email', error: err, outreach_id: row.id }, NODE);
    }
  };

  const doForm = async (): Promise<boolean> => {
    if (done('form')) return true;
    const node = `outreach:${id}:form`;
    const url = isSandbox ? `${cand.url}${cand.url.includes('?') ? '&' : '?'}run=${run.id}&cand=${id}` : await findDemoUrl(cand.url);
    const profile = buildFormProfile(run, message);
    const [row] = await sbInsert<{ id: number }>('outreach', { run_id: run.id, candidate_id: id, gap_field, channel: 'form', target: url, status: 'planned', message, sandbox: isSandbox });
    rows.push(row.id);
    await emit(run.id, node, 'outreach_planned', { candidate_id: id, channel: 'form', gap_fields: gapFields, target: url, message, outreach_id: row.id, will_submit: isSandbox, sandbox: isSandbox, synthetic_gap: t.synthetic }, NODE);
    let r: Awaited<ReturnType<typeof callFillForm>>;
    try {
      r = await callFillForm(url, profile, isSandbox, run.id, id);
    } catch (e) {
      r = { status: 'failed', fields: [], error: (e as Error).message.slice(0, 300) };
    }
    const fields = (r.fields ?? []).filter(f => f.value).map(f => ({ label: f.label, value: f.value, kind: f.kind }));
    const common = { candidate_id: id, channel: 'form', target: url, fields, screenshot_url: r.screenshot_url ?? null, outreach_id: row.id, sandbox: isSandbox };
    if (r.status === 'filled' || r.status === 'submitted') {
      // never overwrite 'replied' (the sandbox rep can answer while we are still writing)
      await sbPatch('outreach', `id=eq.${row.id}&status=in.(planned,filled,submitted)`, { status: r.status, screenshot_url: r.screenshot_url ?? null });
      await emit(run.id, node, 'outreach_filled', { ...common, status: r.status, submitted: r.status === 'submitted' }, NODE);
      if (r.status === 'submitted') await emit(run.id, node, 'outreach_sent', { ...common, after_url: r.after_url ?? null, after_text: r.after_text ?? null }, NODE);
      return true;
    }
    if (r.status === 'blocked') {
      await sbPatch('outreach', `id=eq.${row.id}`, { status: 'blocked', screenshot_url: r.screenshot_url ?? null, error: r.error ?? 'blocked' });
      await emit(run.id, node, 'outreach_blocked', { ...common, reason: r.error ?? 'blocked' }, NODE);
      return true; // a deliberate block is not a failure to recover from
    }
    const err = r.error ?? 'form fill failed';
    await sbPatch('outreach', `id=eq.${row.id}`, { status: 'failed', screenshot_url: r.screenshot_url ?? null, error: err.slice(0, 400) });
    await emit(run.id, node, 'node_failed', { ...common, error: err }, NODE);
    await emit(run.id, node, 'recovery_started', { candidate_id: id, from: 'form', to: 'email', why: err.slice(0, 200) }, NODE);
    return false;
  };

  if (wantsEmailFirst) {
    await doEmail();
  } else if (!(await doForm())) {
    await doEmail('form failed (captcha / bot wall / no form / iframe)');
  }
  return { cand: id, rows };
}

// ------------------------------------------------------------------ phase
export async function run(runId: string, _args: Record<string, any> = {}): Promise<void> {
  await emit(runId, NODE, 'node_started', { phase: 'outreach' }, 'orchestrator');
  try {
    await assertBudget(runId);
    const [runRow] = await sbSelect<RunRow>('runs', `id=eq.${runId}&select=id,doc_text,profile,candidates,verdicts,gaps,status`);
    if (!runRow) throw new Error(`run ${runId} not found`);
    await sbPatch('runs', `id=eq.${runId}`, { status: 'outreach' });
    const targets = pickTargets(runRow);
    const existing = await sbSelect<{ candidate_id: string; channel: string; status: string }>('outreach', `run_id=eq.${runId}&select=candidate_id,channel,status`);

    if (!targets.length) {
      await emit(runId, NODE, 'node_done', { phase: 'outreach', vendors: 0, note: 'no non-disqualified candidate has a gap worth chasing' }, 'orchestrator');
      await sbPatch('runs', `id=eq.${runId}`, { status: 'rescoring' });
      await emit(runId, 'orchestrator', 'run_resumed', { reason: 'no_outreach_targets' });
      return;
    }
    await emit(runId, NODE, 'tool_call', { selected: targets.map(t => ({ candidate_id: t.cand.id, gaps: t.gaps.map(g => g.field), synthetic_gap: t.synthetic })) }, 'orchestrator');

    const results = await Promise.all(targets.map(t => chase(runRow, t, existing).catch(async e => {
      await emit(runId, `outreach:${t.cand.id}`, 'node_failed', { candidate_id: t.cand.id, error: (e as Error).message.slice(0, 300) }, NODE).catch(() => {});
      return { cand: t.cand.id, rows: [] as number[] };
    })));

    const rows = await sbSelect<{ id: number; candidate_id: string; channel: string; status: string }>('outreach', `run_id=eq.${runId}&select=id,candidate_id,channel,status&order=id`);
    await emit(runId, NODE, 'node_done', { phase: 'outreach', vendors: targets.map(t => t.cand.id), outreach: rows.map(r => `${r.candidate_id}:${r.channel}:${r.status}`) }, 'orchestrator');
    // park only if the run is still in 'outreach': a fast sandbox reply may already have moved it to 'rescoring'
    const parked = await sbPatch('runs', `id=eq.${runId}&status=eq.outreach`, { status: 'awaiting_vendor' });
    if (parked.length) await emit(runId, 'orchestrator', 'run_parked', { awaiting: results.map(r => r.cand), outreach: rows.map(r => ({ id: r.id, candidate_id: r.candidate_id, channel: r.channel, status: r.status })) });
  } catch (e) {
    await emit(runId, NODE, 'node_failed', { phase: 'outreach', error: (e as Error).message.slice(0, 400) }, 'orchestrator').catch(() => {});
    throw e;
  }
}
