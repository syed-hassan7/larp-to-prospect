import { callLogic } from '../../agents/voice/call.js';
import { cors, readJson } from '../../agents/voice/shared.js';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const b = await readJson(req);
    const r = await callLogic({ run_id: b.run_id, to_number: b.to_number });
    res.status(r.status).json(r.body);
  } catch (e: any) { res.status(500).json({ error: 'call_failed', message: String(e?.message ?? e).slice(0, 300) }); }
}
