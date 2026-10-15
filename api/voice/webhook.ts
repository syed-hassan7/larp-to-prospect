import { webhookLogic } from '../../agents/voice/webhook.js';
import { readRaw } from '../../agents/voice/shared.js';
// Raw body is required for HMAC verification: disable Vercel's body parser (documented pattern for signed webhooks).
export const config = { runtime: 'nodejs', api: { bodyParser: false } };
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const raw = await readRaw(req);
    const r = await webhookLogic(raw, req.headers['elevenlabs-signature'] as string | undefined);
    res.status(r.status).json(r.body);
  } catch (e: any) { res.status(500).json({ error: 'webhook_failed', message: String(e?.message ?? e).slice(0, 300) }); }
}
