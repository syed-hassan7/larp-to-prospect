// Page fetch chain with visible recovery: Firecrawl -> Keenable -> Tavily extract -> Jina reader.
// Every failed hop emits node_failed then recovery_started {from,to,reason}. injectFailure force-fails the primary hop
// (payload.injected=true) so the UI can label it. Also exports the two web-search helpers used by discover/research.
import { env, emit } from '../lib/core.js';

export type Hop = 'firecrawl' | 'keenable' | 'tavily' | 'jina';
export interface FetchAttempt { hop: Hop; ok: boolean; ms: number; chars?: number; error?: string; injected?: boolean; skipped?: boolean }
export interface FetchResult { url: string; text: string; source: Hop; attempts: FetchAttempt[]; title?: string }
export interface FetchOpts {
  runId?: string; nodeId?: string; parentId?: string | null;
  injectFailure?: boolean; timeoutMs?: number;
}
export class FetchChainError extends Error {
  attempts: FetchAttempt[];
  constructor(url: string, attempts: FetchAttempt[]) {
    super(`all fetch hops failed for ${url}: ` + attempts.map(a => `${a.hop}: ${a.error}`).join(' | '));
    this.name = 'FetchChainError';
    this.attempts = attempts;
  }
}

const HOP_TIMEOUT_MS = 20_000;

// Local throttles so a parallel fan-out does not just trip provider limits (measured: Firecrawl 429s after ~10 req/min, Keenable 10 RPS).
const FC_WINDOW_MS = 60_000, FC_MAX = 9;
const fcStamps: number[] = [];
function firecrawlSlotFree(): boolean {
  const now = Date.now();
  while (fcStamps.length && now - fcStamps[0] > FC_WINDOW_MS) fcStamps.shift();
  if (fcStamps.length >= FC_MAX) return false;
  fcStamps.push(now);
  return true;
}
let keenNext = 0;
async function keenableSlot(): Promise<void> { // >=150ms spacing between Keenable calls (search + fetch)
  const now = Date.now(), at = Math.max(now, keenNext);
  keenNext = at + 150;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}
const sig = (ms: number) => AbortSignal.timeout(ms);

async function readJson(res: Response, what: string): Promise<any> {
  const t = await res.text();
  if (!res.ok) throw new Error(`${what} HTTP ${res.status}: ${t.slice(0, 160).replace(/\s+/g, ' ')}`);
  try { return JSON.parse(t); } catch { throw new Error(`${what} returned non-JSON: ${t.slice(0, 100)}`); }
}

type HopFn = (url: string, ms: number) => Promise<{ text: string; title?: string }>;
const HOPS: { hop: Hop; fn: HopFn }[] = [
  {
    hop: 'firecrawl',
    fn: async (url, ms) => {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('FIRECRAWL_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
        signal: sig(ms),
      });
      const j = await readJson(res, 'firecrawl');
      if (!j.success) throw new Error('firecrawl success=false: ' + JSON.stringify(j).slice(0, 160));
      const sc = j.data?.metadata?.statusCode;
      if (sc && sc >= 400) throw new Error(`firecrawl target status ${sc}`);
      return { text: j.data?.markdown ?? '', title: j.data?.metadata?.title };
    },
  },
  {
    hop: 'keenable',
    fn: async (url, ms) => {
      await keenableSlot();
      const res = await fetch('https://api.keenable.ai/v1/fetch?url=' + encodeURIComponent(url), {
        headers: { 'X-API-Key': env('KEENABLE_API_KEY') }, signal: sig(ms),
      });
      const j = await readJson(res, 'keenable');
      return { text: j.content ?? '', title: j.title };
    },
  },
  {
    hop: 'tavily',
    fn: async (url, ms) => {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env('TAVILY_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
        signal: sig(ms),
      });
      const j = await readJson(res, 'tavily');
      const r = j.results?.[0];
      if (!r) throw new Error('tavily extract: no result' + (j.failed_results?.[0]?.error ? ` (${j.failed_results[0].error})` : ''));
      return { text: r.raw_content ?? '', title: r.title };
    },
  },
  {
    hop: 'jina',
    fn: async (url, ms) => {
      const res = await fetch('https://r.jina.ai/' + url, { signal: sig(ms) });
      const t = await res.text();
      if (!res.ok) throw new Error(`jina HTTP ${res.status}: ${t.slice(0, 120).replace(/\s+/g, ' ')}`);
      return { text: t };
    },
  },
];

/** null = fine, otherwise the reason this content is unusable (empty page, challenge page...). */
function badContent(text: string): string | null {
  const t = (text ?? '').trim();
  if (t.length < 200) return `content too short (${t.length} chars)`;
  if (t.length < 3000 && /just a moment|enable javascript and cookies|attention required|access denied|verify you are human|are you a robot/i.test(t)) return 'bot-wall / challenge page';
  return null;
}

const errReason = (e: any): string =>
  e?.name === 'TimeoutError' || e?.name === 'AbortError' ? `timeout after ${HOP_TIMEOUT_MS / 1000}s` : String(e?.message ?? e).slice(0, 220);

export async function fetchPage(url: string, opts: FetchOpts = {}): Promise<FetchResult> {
  const { runId, nodeId, parentId = null, injectFailure = false } = opts;
  const ms = opts.timeoutMs ?? HOP_TIMEOUT_MS;
  const attempts: FetchAttempt[] = [];
  const ev = (type: string, payload: Record<string, unknown>) =>
    runId && nodeId ? emit(runId, nodeId, type, payload, parentId).catch(() => {}) : Promise.resolve();

  for (let i = 0; i < HOPS.length; i++) {
    const { hop, fn } = HOPS[i];
    const t0 = Date.now();
    const injected = i === 0 && injectFailure;
    if (hop === 'firecrawl' && !injected && !firecrawlSlotFree()) { // local rate window full: skip quietly (not a failure, no UI event)
      attempts.push({ hop, ok: false, ms: 0, skipped: true, error: `skipped: local Firecrawl rate window full (${FC_MAX}/min)` });
      continue;
    }
    try {
      if (injected) throw new Error('injected failure: primary hop force-failed (demo toggle)');
      const r = await fn(url, ms);
      const bad = badContent(r.text);
      if (bad) throw new Error(bad);
      attempts.push({ hop, ok: true, ms: Date.now() - t0, chars: r.text.length });
      return { url, text: r.text, source: hop, attempts, title: r.title };
    } catch (e) {
      const reason = errReason(e);
      attempts.push({ hop, ok: false, ms: Date.now() - t0, error: reason, ...(injected ? { injected: true } : {}) });
      const next = HOPS[i + 1]?.hop ?? null;
      const base = { url, from: hop, to: next, reason, ...(injected ? { injected: true } : {}) };
      await ev('node_failed', { ...base, hop, exhausted: next === null });
      if (next) await ev('recovery_started', base);
    }
  }
  throw new FetchChainError(url, attempts);
}

// ---------- search helpers (shared by discover + research) ----------
export interface SearchHit { url: string; title: string; snippet: string; engine: 'tavily' | 'keenable' }

export async function tavilySearch(query: string, o: { max?: number; includeDomains?: string[]; excludeDomains?: string[] } = {}): Promise<SearchHit[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('TAVILY_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query, max_results: o.max ?? 8, search_depth: 'basic',
      ...(o.includeDomains?.length ? { include_domains: o.includeDomains } : {}),
      ...(o.excludeDomains?.length ? { exclude_domains: o.excludeDomains } : {}),
    }),
    signal: sig(HOP_TIMEOUT_MS),
  });
  const j = await readJson(res, 'tavily search');
  return (j.results ?? []).map((r: any) => ({ url: r.url, title: r.title ?? '', snippet: String(r.content ?? '').slice(0, 400), engine: 'tavily' as const }));
}

export async function keenableSearch(query: string, o: { max?: number; site?: string } = {}): Promise<SearchHit[]> {
  await keenableSlot();
  const res = await fetch('https://api.keenable.ai/v1/search', {
    method: 'POST',
    headers: { 'X-API-Key': env('KEENABLE_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: o.max ?? 8, ...(o.site ? { site: o.site } : {}) }),
    signal: sig(HOP_TIMEOUT_MS),
  });
  const j = await readJson(res, 'keenable search');
  return (j.results ?? []).map((r: any) => ({ url: r.url, title: r.title ?? '', snippet: String(r.snippet || r.description || '').slice(0, 400), engine: 'keenable' as const }));
}
