// Public: start a run. Guarded by a global rate limit (spend protection) and doc size cap.
import { waitUntil } from '@vercel/functions';
import { sbInsert, sbSelect } from '../../lib/core.js';
import { runStage } from '../../agents/orchestrator.js';
import { cors, readJson } from '../../agents/voice/shared.js';
export const config = { runtime: 'nodejs', maxDuration: 120 };

export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = await readJson(req).catch(() => ({}));
  const doc = String(body.doc_text ?? '').trim();
  if (doc.length < 80) return res.status(400).json({ error: 'doc_text too short' });
  if (doc.length > 20000) return res.status(413).json({ error: 'doc_text too long (20k max)' });
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const recent = await sbSelect('runs', `created_at=gte.${since}&select=id`);
  if (recent.length >= 8) return res.status(429).json({ error: 'rate_limited', message: 'Too many runs in the last 10 minutes.' });
  const [run] = await sbInsert('runs', { doc_text: doc, inject_failure: !!body.inject_failure, status: 'queued' });
  waitUntil(runStage(run.id, 'research').catch(e => console.error('[run]', run.id, e.message)));
  res.status(200).json({ run_id: run.id });
}
