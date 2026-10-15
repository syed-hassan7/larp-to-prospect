import { runStage } from '../agents/orchestrator.js';
import { sbSelect } from '../lib/core.js';
const runId = process.argv[2];
await runStage(runId, 'rescore', { chain: false });
const [r] = await sbSelect<any>('runs', `id=eq.${runId}&select=status,verdicts,deck,cost_usd`);
for (const [k, v] of Object.entries<any>(r.verdicts)) console.log(k.padEnd(20), v.verdict.padEnd(12), v.score, Object.entries<any>(v.cells).map(([c, x]) => `${c}=${x.cell}`).join(' '));
console.log('status', r.status, 'deck v', r.deck.version, 'cost', r.cost_usd);
console.log('verdict slide:', r.deck.slides[0].title);
console.log('note:', r.verdicts['northwind-sandbox']?.cells?.public_pricing?.note);
