import { actLogic } from '../agents/voice/act.js';
import { cors, readJson } from '../agents/voice/shared.js';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const r = await actLogic(await readJson(req));
    res.status(r.status).json(r.body);
  } catch (e: any) { res.status(500).json({ error: 'act_failed', message: String(e?.message ?? e).slice(0, 300) }); }
}
