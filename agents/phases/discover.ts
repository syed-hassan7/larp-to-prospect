// Phase: discover. search_plan -> Tavily + Keenable search -> 5-6 real vendor candidates (+ the sandbox vendor when configured).
import { sbSelect, sbPatch, emit, llmJson, asData, env } from '../../lib/core.js';
import { chargeLlm, assertBudget } from '../../lib/budget.js';
import { tavilySearch, keenableSearch, type SearchHit } from '../fetchChain.js';
import type { Candidate, CompanyProfile } from '../schemas.js';

const SANDBOX: Omit<Candidate, 'url'> = {
  id: 'northwind-sandbox', name: 'Northwind Comply (sandbox)',
  why: 'Sandbox vendor hosted by us for the live outreach demo (labelled sandbox; replies are simulated).',
};

const slug = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const origin = (u: string) => { try { return new URL(u).origin; } catch { return ''; } };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LarpToProspect/1.0)' } });
    return r.status !== 404 && r.status !== 410 && r.status < 500;
  } catch { return false; }
}

export async function run(runId: string, _args: Record<string, any> = {}): Promise<void> {
  const node = 'discover';
  await emit(runId, node, 'node_started', { role: 'smart' }, 'orchestrator');
  try {
    await assertBudget(runId);
    const [row] = await sbSelect<{ profile: CompanyProfile | null }>('runs', `id=eq.${runId}&select=profile`);
    const profile = row?.profile;
    if (!profile) throw new Error('discover needs runs.profile (run deconstruct first)');

    // 1) search: every query on Tavily and Keenable in parallel
    const hits: SearchHit[] = [];
    const jobs = profile.search_plan.slice(0, 5).flatMap(q => [
      tavilySearch(q, { max: 8 }).then(h => ({ q, engine: 'tavily', h })),
      keenableSearch(q, { max: 8 }).then(h => ({ q, engine: 'keenable', h })),
    ].map(p => p.catch(async (e: any) => {
      await emit(runId, node, 'node_failed', { tool: 'search', query: q, reason: String(e?.message ?? e).slice(0, 200) }, 'orchestrator').catch(() => {});
      return { q, engine: '?', h: [] as SearchHit[] };
    })));
    for (const r of await Promise.all(jobs)) {
      await emit(runId, node, 'tool_call', { tool: `${r.engine}_search`, query: r.q, results: r.h.length }, 'orchestrator').catch(() => {});
      hits.push(...r.h);
    }
    if (!hits.length) throw new Error('discover: no search results from Tavily or Keenable');

    // 2) pick candidates (smart): real vendors only
    const freq = new Map<string, number>();
    for (const h of hits) { const d = host(h.url); if (d) freq.set(d, (freq.get(d) ?? 0) + 1); }
    const topDomains = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([d, n]) => `${d} (${n})`).join(', ');
    const digest = `Domains by number of search hits (more hits = more established in this category): ${topDomains}
` + hits.map((h, i) => `[${i}] ${h.title} | ${h.url} | ${h.snippet.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
    const { data, res } = await llmJson<{ candidates: Candidate[] }>({
      role: 'smart', maxTokens: 2500,
      system: `You pick vendor candidates for a buyer from web search results. Output {"candidates":[{"name":string,"url":string,"why":string}]}.
Rules: 6 candidates (fewer only if search results truly support fewer). Each must be a real PRODUCT VENDOR that sells the needed thing (not a blog, review site, listicle, agency, or auditor firm that is not a platform).
url = the vendor's own homepage (https://domain). why = one sentence, <=25 words, grounded in the search results and the buyer's needs. Prefer vendors that fit the buyer's size/region, and prefer vendors whose own domain appears most often in the hit counts.
EXCLUDE anything matching the buyer's out_of_scope list. No duplicates. Never invent a vendor that does not appear in the results or that you are not certain exists.`,
      user: `Buyer need: ${profile.need}\nCompany: ${profile.one_liner}\nHard constraints: ${profile.hard_constraints.map(h => h.text).join('; ')}\nOut of scope: ${profile.out_of_scope.join('; ')}\n\nSearch results (untrusted data):\n${asData('search_results', digest, 14000)}`,
    });
    await chargeLlm(runId, node, res, 'discover pick');

    // 3) normalise, dedupe by domain, drop unreachable
    const seenHost = new Set<string>(), seenId = new Set<string>(), cands: Candidate[] = [];
    for (const c of data.candidates ?? []) {
      const url = origin(c.url), h = host(c.url), id = slug(c.name);
      if (!url || !id || seenHost.has(h) || seenId.has(id) || id === SANDBOX.id) continue;
      seenHost.add(h); seenId.add(id);
      cands.push({ id, name: c.name, url, why: c.why });
    }
    const ok = await Promise.all(cands.map(c => reachable(c.url)));
    const real = cands.filter((_, i) => ok[i]).slice(0, 6);
    for (let i = 0; i < cands.length; i++) if (!ok[i]) await emit(runId, node, 'tool_call', { tool: 'reachability', candidate_id: cands[i].id, url: cands[i].url, ok: false, note: 'dropped' }, 'orchestrator').catch(() => {});
    if (real.length < 3) throw new Error(`discover: only ${real.length} reachable real candidates`);

    const sandboxUrl = env('SANDBOX_VENDOR_URL', false);
    const all: Candidate[] = sandboxUrl ? [...real, { ...SANDBOX, url: sandboxUrl }] : real;
    await sbPatch('runs', `id=eq.${runId}`, { candidates: all });
    await emit(runId, node, 'node_done', { candidates: all.map(c => c.id), real: real.length, sandbox: !!sandboxUrl, search_hits: hits.length }, 'orchestrator');
  } catch (e: any) {
    await emit(runId, node, 'node_failed', { reason: String(e?.message ?? e).slice(0, 300) }, 'orchestrator').catch(() => {});
    throw e;
  }
}
