import { sbInsert, sbSelect, sbDelete, emit, llm, llmJson } from '../lib/core.js';

const [run] = await sbInsert('runs', { doc_text: 'core smoke test' });
console.log('run', run.id);
const seqs = await Promise.all([1, 2, 3, 4, 5].map(i => emit(run.id, 'smoke', 'tool_call', { i })));
console.log('parallel emit seqs (must be 5 unique):', seqs.sort().join(','), new Set(seqs).size === 5 ? 'OK' : 'COLLISION');
const evs = await sbSelect('run_events', `run_id=eq.${run.id}&select=seq,type&order=seq`);
console.log('events read back:', evs.length);
for (const role of ['fast', 'smart', 'skeptic'] as const) {
  const r = await llm({ role, user: 'Reply with the single word: ok', maxTokens: 300 });
  console.log(role, r.model, JSON.stringify(r.text.trim()), 'tokens', r.usage, '$' + r.cost_usd.toFixed(6));
}
const { data } = await llmJson<{ n: number }>({ role: 'fast', user: 'Give {"n": 3}' });
console.log('json parse:', data);
await sbDelete('runs', `id=eq.${run.id}`);
console.log('cleanup done');
