// Orchestrator: chains phases. Each Vercel invocation runs ONE stage (<120s) then hands off by POSTing /api/run/phase,
// so the run survives across functions and can park for hours waiting on a vendor.
//   research stage: deconstruct -> discover -> research x N (parallel) -> skeptic -> deck v1   => hands off to outreach
//   outreach stage: outreach (forms / email / sandbox submit) -> run parks (awaiting_vendor)
//   rescore stage (fired by /api/ingest when a vendor replies): skeptic again over the enriched ledger -> deck v2
import { sbSelect, sbPatch, emit, env } from '../lib/core.js';
import * as deconstruct from './phases/deconstruct.js';
import * as discover from './phases/discover.js';
import * as research from './phases/research.js';
import * as skeptic from './phases/skeptic.js';
import * as outreach from './phases/outreach.js';
import * as deck from './phases/deck.js';

export type Stage = 'research' | 'outreach' | 'rescore';
const MAX_REAL = 4; // keeps the research stage well under the 120s function limit

export async function handoff(runId: string, stage: Stage): Promise<void> {
  const base = env('PUBLIC_BASE_URL', false);
  if (!base) throw new Error('PUBLIC_BASE_URL not set; cannot hand off');
  const r = await fetch(`${base}/api/run/phase`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-key': env('INTERNAL_API_KEY') },
    body: JSON.stringify({ run_id: runId, stage }),
  });
  if (!r.ok) throw new Error(`handoff ${stage} -> ${r.status}`);
}

export async function runStage(runId: string, stage: Stage, opts: { chain?: boolean } = {}): Promise<void> {
  const chain = opts.chain ?? true;
  try {
    if (stage === 'research') {
      await emit(runId, 'orchestrator', 'node_started', { label: 'Orchestrator', stage });
      await sbPatch('runs', `id=eq.${runId}`, { status: 'researching' });
      await deconstruct.run(runId);
      await discover.run(runId);
      const [r] = await sbSelect<{ candidates: { id: string }[] }>('runs', `id=eq.${runId}&select=candidates`);
      const all = r.candidates ?? [];
      const pick = [...all.filter(c => c.id !== 'northwind-sandbox').slice(0, MAX_REAL), ...all.filter(c => c.id === 'northwind-sandbox')];
      await Promise.all(pick.map(c => research.run(runId, { candidate_id: c.id }).catch(() => {})));
      await skeptic.run(runId, { candidate_ids: pick.map(c => c.id) });
      await deck.run(runId);
      await sbPatch('runs', `id=eq.${runId}`, { status: 'outreach' });
      if (chain) await handoff(runId, 'outreach'); else await runStage(runId, 'outreach', opts);
    } else if (stage === 'outreach') {
      await sbPatch('runs', `id=eq.${runId}`, { status: 'outreach' });
      await outreach.run(runId);
    } else if (stage === 'rescore') {
      await emit(runId, 'orchestrator', 'node_started', { label: 'Rescore', stage });
      await sbPatch('runs', `id=eq.${runId}`, { status: 'rescoring' });
      await skeptic.run(runId);
      await deck.run(runId);
      await sbPatch('runs', `id=eq.${runId}`, { status: 'deck_ready' });
      await emit(runId, 'orchestrator', 'node_done', { label: 'Rescore', stage });
    }
  } catch (e) {
    await emit(runId, 'orchestrator', 'node_failed', { stage, error: (e as Error).message.slice(0, 400) }).catch(() => {});
    await sbPatch('runs', `id=eq.${runId}`, { status: 'failed' }).catch(() => {});
    throw e;
  }
}
