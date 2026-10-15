// Internal: run one orchestrator stage in its own function invocation (handoff target).
import { waitUntil } from '@vercel/functions';
import { runStage, type Stage } from '../../agents/orchestrator.js';
import { internalKeyOk, readJson } from '../../agents/voice/shared.js';
export const config = { runtime: 'nodejs', maxDuration: 120 };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!internalKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const { run_id, stage } = await readJson(req).catch(() => ({} as any));
  if (!run_id || !['research', 'outreach', 'rescore'].includes(stage)) return res.status(400).json({ error: 'run_id + stage required' });
  waitUntil(runStage(run_id, stage as Stage).catch(e => console.error('[phase]', run_id, stage, e.message)));
  res.status(202).json({ ok: true, run_id, stage });
}
