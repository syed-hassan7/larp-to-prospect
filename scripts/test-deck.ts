import * as deck from '../agents/phases/deck.js';
import { sbSelect } from '../lib/core.js';
const runId = process.argv[2];
const t = Date.now();
await deck.run(runId);
const [r] = await sbSelect<any>('runs', `id=eq.${runId}&select=deck`);
for (const s of r.deck.slides) console.log(`[${s.kind}] ${s.title}\n   narr(${s.narration.length}): ${s.narration.slice(0, 160)}\n   audio: ${s.audio_url ? 'yes' : 'NO'}`);
const a = r.deck.slides.find((s: any) => s.audio_url);
if (a) { const h = await fetch(a.audio_url); console.log('audio check', h.status, h.headers.get('content-type'), (await h.arrayBuffer()).byteLength, 'bytes'); }
console.log('secs', ((Date.now() - t) / 1000).toFixed(1));
