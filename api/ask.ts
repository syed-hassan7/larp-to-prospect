import { askLogic } from '../agents/voice/ask.js';
import { cors, readJson } from '../agents/voice/shared.js';
export const config = { runtime: 'nodejs' };
// Browser-callable (public, read-only analysis; costs a few cents per call and is budget-guarded per run).
export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const b = await readJson(req);
    const r = await askLogic({ run_id: b.run_id, question: b.question, transcript: b.transcript, mode: 'ask', source: 'ask' });
    res.status(r.status).json(r.body);
  } catch (e: any) { res.status(500).json({ error: 'ask_failed', message: String(e?.message ?? e).slice(0, 300) }); }
}
