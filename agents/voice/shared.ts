// Shared voice-layer helpers: voice pick, ElevenLabs fetch, run loading, briefing, tiny HTTP helpers.
import { timingSafeEqual } from 'node:crypto';
import { env, sbSelect } from '../../lib/core.js';

export const EL = 'https://api.elevenlabs.io';
export const elKey = () => env('ELEVENLABS_API_KEY');
export const DEMO_INBOX = 'acme.procurement.demo@gmail.com';
export const PLACEHOLDER_HOST = 'https://set-public-base-url.example.com';

export async function el<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; text: string }> {
  const res = await fetch(EL + path, {
    method,
    headers: { 'xi-api-key': elKey(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data, text };
}

// ---------- voice ----------
export interface VoicePick { voice_id: string; name: string; accent: string }
let voiceCache: VoicePick | null = null;
/** UK-leaning, warm+crisp female premade voice. Override with ELEVENLABS_VOICE_ID. Same pick is used by agent and narration. */
export async function pickVoice(): Promise<VoicePick> {
  if (voiceCache) return voiceCache;
  const forced = env('ELEVENLABS_VOICE_ID', false);
  const r = await el<any>('GET', '/v2/voices?page_size=100');
  if (r.status !== 200) throw new Error(`list voices -> ${r.status} ${r.text.slice(0, 200)}`);
  const voices: any[] = r.data.voices ?? [];
  const pref = ['Alice', 'Lily', 'George', 'Daniel'];
  let v = forced ? voices.find(x => x.voice_id === forced) : undefined;
  if (!v) for (const p of pref) { v = voices.find(x => String(x.name).startsWith(p) && x.labels?.accent === 'british'); if (v) break; }
  if (!v) v = voices.find(x => x.labels?.accent === 'british') ?? voices[0];
  if (!v) throw new Error('no voices available on this account');
  voiceCache = { voice_id: v.voice_id, name: v.name, accent: v.labels?.accent ?? '?' };
  return voiceCache;
}

// ---------- run ledger ----------
export interface RunBundle { run: any; claims: any[]; outreach: any[]; candidates: { id: string; name: string; url?: string; why?: string }[]; verdicts: Record<string, any>; gaps: any[] }

export async function loadRun(runId: string): Promise<RunBundle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [run] = await sbSelect('runs', `id=eq.${runId}&select=*`);
  if (!run) return null;
  const [claims, outreach] = await Promise.all([
    sbSelect('claims', `run_id=eq.${runId}&select=id,candidate_id,field,value,source_url,quote,confidence,source_type,channel,created_at&order=id`),
    sbSelect('outreach', `run_id=eq.${runId}&select=*&order=id`),
  ]);
  const verdicts: Record<string, any> = {};
  const rv = run.verdicts ?? {};
  if (Array.isArray(rv)) for (const v of rv) verdicts[v.candidate_id] = v; else Object.assign(verdicts, rv);
  const candidates: RunBundle['candidates'] = Array.isArray(run.candidates) ? run.candidates : [];
  for (const id of Object.keys(verdicts)) if (!candidates.find(c => c.id === id)) candidates.push({ id, name: id });
  return { run, claims, outreach, candidates, verdicts, gaps: Array.isArray(run.gaps) ? run.gaps : [] };
}

export const nameOf = (b: RunBundle, id: string) => b.candidates.find(c => c.id === id)?.name ?? id;
export const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u.slice(0, 40); } };

/** Deterministic briefing from the skeptic's verdicts: dynamic variables for the agent. No LLM, no invention. */
export function buildBriefing(b: RunBundle) {
  const vs = Object.values(b.verdicts) as any[];
  const byScore = (a: any, c: any) => (c.score ?? 0) - (a.score ?? 0);
  const q = vs.filter(v => v.verdict === 'qualified').sort(byScore);
  const d = vs.filter(v => v.verdict === 'disqualified');
  const u = vs.filter(v => v.verdict === 'unverified').sort(byScore);
  const top = q[0] ?? u[0];
  const parts: string[] = [];
  if (q.length) parts.push(`${q.map(v => nameOf(b, v.candidate_id)).join(' and ')} ${q.length > 1 ? 'qualify' : 'qualifies'}.`);
  if (d.length) parts.push(d.map(v => `${nameOf(b, v.candidate_id)} is ruled out${v.disqualified_because ? ': ' + String(v.disqualified_because).slice(0, 120) : ''}.`).join(' '));
  if (u.length) parts.push(`${u.map(v => nameOf(b, v.candidate_id)).join(' and ')} still ${u.length > 1 ? 'have' : 'has'} unanswered questions.`);
  return {
    run_id: b.run.id as string,
    company: (b.run.profile?.company as string) || 'Acme Solutions',
    top_pick: top ? nameOf(b, top.candidate_id) : 'none yet',
    summary: parts.join(' ') || 'The research has not produced verdicts yet.',
  };
}

// ---------- http ----------
export function cors(req: any, res: any): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-internal-key');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
export async function readRaw(req: any): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}
export async function readJson(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = await readRaw(req);
  return raw ? JSON.parse(raw) : {};
}
export function internalKeyOk(req: any): boolean {
  const want = process.env.INTERNAL_API_KEY ?? '';
  const got = String(req.headers?.['x-internal-key'] ?? '');
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
export type HandlerResult = { status: number; body: any };
