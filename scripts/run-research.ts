// End-to-end research run against LIVE services on the Acme brief.
// usage: npx tsx --env-file=.env scripts/run-research.ts [--inject] [--run <existing_run_id>] [--only deconstruct,discover,research,skeptic]
import { readFileSync } from 'node:fs';
import { sbInsert, sbSelect, sbPatch } from '../lib/core.js';
import * as deconstruct from '../agents/phases/deconstruct.js';
import * as discover from '../agents/phases/discover.js';
import * as research from '../agents/phases/research.js';
import * as skeptic from '../agents/phases/skeptic.js';
import type { Candidate } from '../agents/schemas.js';

const argv = process.argv.slice(2);
const inject = argv.includes('--inject');
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const s = Date.now();
  try { return await fn(); } finally { console.log(`  [${name}] ${((Date.now() - s) / 1000).toFixed(1)}s`); }
}

let runId = arg('--run');
if (!runId) {
  const doc = readFileSync(new URL('../fixtures/acme-company-doc.md', import.meta.url), 'utf8');
  const [r] = await sbInsert('runs', { doc_text: doc, inject_failure: inject, status: 'queued' });
  runId = r.id as string;
}
console.log(`run ${runId}  inject_failure=${inject}  SANDBOX_VENDOR_URL=${process.env.SANDBOX_VENDOR_URL ? 'set' : 'unset (sandbox skipped)'}`);

await timed('deconstruct', () => deconstruct.run(runId!));
await timed('discover', () => discover.run(runId!));
const [r1] = await sbSelect<{ candidates: Candidate[] }>('runs', `id=eq.${runId}&select=candidates`);
const real = r1.candidates.filter(c => c.id !== 'northwind-sandbox').slice(0, 5);
const sandbox = r1.candidates.filter(c => c.id === 'northwind-sandbox');
const toResearch = [...real, ...sandbox];
console.log('  candidates:', r1.candidates.map(c => `${c.id}<${c.url}>`).join(', '));
await timed(`research x${toResearch.length} (parallel)`, () => Promise.all(toResearch.map(c => research.run(runId!, { candidate_id: c.id }))));
await timed('skeptic', () => skeptic.run(runId!, { candidate_ids: toResearch.map(c => c.id) }));
await sbPatch('runs', `id=eq.${runId}`, { status: 'deck_ready' }).catch(() => {});

// ---------------- summary (all from Supabase, not from memory) ----------------
const [run] = await sbSelect<any>('runs', `id=eq.${runId}&select=cost_usd,verdicts,gaps,profile,candidates`);
const claims = await sbSelect<any>('claims', `run_id=eq.${runId}&select=id,candidate_id,field,value,confidence&order=id`);
const events = await sbSelect<any>('run_events', `run_id=eq.${runId}&select=seq,node_id,type,payload&order=seq&limit=5000`);
const count = (t: string) => events.filter((e: any) => e.type === t).length;

console.log('\n===== SUMMARY =====');
console.log('profile:', run.profile.company, '| cap £', run.profile.budget_cap_gbp, '| hard:', run.profile.hard_constraints.map((h: any) => `${h.id}(${h.field})`).join(', '));
console.log('events:', events.length, '| claim_added', count('claim_added'), '| claim_rejected', count('claim_rejected'), '| node_failed', count('node_failed'), '| recovery_started', count('recovery_started'), '| cost_tick', count('cost_tick'));
console.log('\nCANDIDATES / CLAIMS (verified vs rejected) / VERDICT');
for (const c of toResearch) {
  const ok = claims.filter((x: any) => x.candidate_id === c.id);
  const rej = events.filter((e: any) => e.type === 'claim_rejected' && e.payload.candidate_id === c.id);
  const v = run.verdicts?.[c.id];
  const byField: Record<string, number> = {};
  for (const x of ok) byField[x.field] = (byField[x.field] ?? 0) + 1;
  console.log(`- ${c.id.padEnd(18)} verified=${String(ok.length).padStart(2)} rejected=${String(rej.length).padStart(2)}  verdict=${v?.verdict ?? '?'} score=${v?.score ?? '?'}  fields=${JSON.stringify(byField)}`);
  if (v) {
    console.log('    cells:', Object.entries(v.cells).map(([k, x]: any) => `${k}=${x.cell}${x.claim_ids.length ? '[' + x.claim_ids.join(',') + ']' : ''}`).join(' '));
    if (v.disqualified_because) console.log('    disqualified_because:', v.disqualified_because);
  }
  for (const r of rej.slice(0, 2)) console.log(`    rejected: [${r.payload.field}] "${String(r.payload.quote).slice(0, 70)}" -> ${r.payload.reason}`);
}
console.log('\nPRICING CLAIMS:');
for (const x of claims.filter((c: any) => c.field === 'pricing')) console.log(`  #${x.id} ${x.candidate_id}: ${x.value}`);
console.log('candidates with NO pricing claim:', toResearch.filter(c => !claims.some((x: any) => x.candidate_id === c.id && x.field === 'pricing')).map(c => c.id).join(', ') || 'none');
console.log('\nGAPS:', (run.gaps ?? []).length);
for (const g of run.gaps ?? []) console.log(`  ${g.candidate_id.padEnd(18)} ${g.field.padEnd(20)} flips=${g.flips_verdict} via ${g.best_channel} — ${g.why_it_matters}`);

console.log('\nFETCH-CHAIN HOPS (node_failed -> recovery_started):');
const fails = events.filter((e: any) => e.type === 'node_failed' && e.payload.from);
const recs = events.filter((e: any) => e.type === 'recovery_started');
console.log(`  hop failures=${fails.length} recoveries=${recs.length} injected=${fails.filter((e: any) => e.payload.injected).length}`);
for (const e of fails.slice(0, 14)) console.log(`  seq ${e.seq} ${e.node_id} ${e.payload.from}->${e.payload.to ?? 'EXHAUSTED'}${e.payload.injected ? ' [INJECTED]' : ''}: ${String(e.payload.reason).slice(0, 90)} (${String(e.payload.url).slice(0, 50)})`);
const other = events.filter((e: any) => e.type === 'node_failed' && !e.payload.from);
if (other.length) { console.log('  other node_failed:'); for (const e of other) console.log(`   ${e.node_id}: ${String(e.payload.reason).slice(0, 140)}`); }
const srcCount: Record<string, number> = {};
for (const e of events) if (e.type === 'node_done' && Array.isArray(e.payload.pages)) for (const p of e.payload.pages) srcCount[p.source] = (srcCount[p.source] ?? 0) + 1;
console.log('  pages fetched by winning hop:', JSON.stringify(srcCount));

console.log(`\nTOTAL COST: $${Number(run.cost_usd).toFixed(4)} (cap $1.50)   WALL TIME: ${secs()}   run_id=${runId}`);
