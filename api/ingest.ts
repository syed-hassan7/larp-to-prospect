import { waitUntil } from '@vercel/functions';
import { ingest, keyOk } from '../agents/ingest.js';
import { handoff } from '../agents/orchestrator.js';
export const config = { runtime: 'nodejs', maxDuration: 120 };
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }
  if (!keyOk(req.headers?.['x-internal-key'])) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const out = await ingest(body);
    // a vendor answered with new evidence -> wake the parked run: rescore in its own invocation
    if (out.ok && out.run_id && out.claims.length > 0) waitUntil(handoff(out.run_id, 'rescore').catch(e => console.error('[ingest->rescore]', e.message)));
    res.status(200).json(out);
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message.slice(0, 300) });
  }
}
