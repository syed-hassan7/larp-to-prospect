import { toolLogic } from '../../../agents/voice/tool.js';
import { cors, readJson, internalKeyOk } from '../../../agents/voice/shared.js';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!internalKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const name = String(req.query?.name ?? req.url?.split('?')[0].split('/').pop() ?? '');
    const r = await toolLogic(name, await readJson(req));
    res.status(r.status).json(r.body);
  } catch (e: any) { res.status(500).json({ error: 'tool_failed', message: String(e?.message ?? e).slice(0, 300) }); }
}
