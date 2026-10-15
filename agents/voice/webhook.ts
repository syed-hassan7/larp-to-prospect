// ElevenLabs post-call webhook: verify HMAC (ElevenLabs-Signature: t=<unix>,v0=<hex of sha256 over "t.rawBody">; 30 min tolerance), store transcript as voice_turn events.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { emit, sbSelect } from '../../lib/core.js';
import type { HandlerResult } from './shared.js';

export function verifySignature(raw: string, header: string | undefined, secret: string): { ok: boolean; reason?: string } {
  if (!header) return { ok: false, reason: 'missing ElevenLabs-Signature header' };
  const parts = header.split(',');
  const t = parts.find(p => p.startsWith('t='))?.slice(2);
  const v0 = parts.find(p => p.startsWith('v0='));
  if (!t || !v0) return { ok: false, reason: 'no t= / v0= in signature header' };
  if (Number(t) * 1000 < Date.now() - 30 * 60_000) return { ok: false, reason: 'timestamp outside 30 minute tolerance' };
  const want = 'v0=' + createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const a = Buffer.from(v0), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

export async function webhookLogic(raw: string, signatureHeader: string | undefined): Promise<HandlerResult> {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? '';
  if (secret) {
    const v = verifySignature(raw, signatureHeader, secret);
    if (!v.ok) return { status: 401, body: { error: 'invalid_signature', reason: v.reason } };
  }
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return { status: 400, body: { error: 'bad_json' } }; }
  if (evt.type !== 'post_call_transcription') return { status: 200, body: { ok: true, ignored: evt.type ?? 'unknown', signature_checked: !!secret } };
  const d = evt.data ?? {};
  const runId = d.conversation_initiation_client_data?.dynamic_variables?.run_id ?? d.metadata?.dynamic_variables?.run_id;
  if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) return { status: 200, body: { ok: true, stored: 0, reason: 'no run_id dynamic variable on this conversation' } };
  const [run] = await sbSelect('runs', `id=eq.${runId}&select=id`);
  if (!run) return { status: 200, body: { ok: true, stored: 0, reason: 'run not found' } };
  // ElevenLabs retries failed deliveries: dedupe on conversation_id.
  const seen = await sbSelect('run_events', `run_id=eq.${runId}&type=eq.voice_turn&payload->>conversation_id=eq.${encodeURIComponent(d.conversation_id ?? '')}&payload->>source=eq.call_webhook&select=id&limit=1`);
  if (seen.length) return { status: 200, body: { ok: true, stored: 0, duplicate: true } };
  let stored = 0;
  for (const [i, t] of (Array.isArray(d.transcript) ? d.transcript : []).entries()) {
    const text = String(t.message ?? '').trim();
    const tools = (t.tool_calls ?? []).map((x: any) => x.tool_name).filter(Boolean);
    if (!text && !tools.length) continue;
    await emit(runId, 'voice', 'voice_turn', { source: 'call_webhook', conversation_id: d.conversation_id, turn: i, role: t.role, text, tool_calls: tools, time_in_call_secs: t.time_in_call_secs ?? null });
    stored++;
  }
  await emit(runId, 'voice', 'voice_turn', { source: 'call_webhook', conversation_id: d.conversation_id, event: 'call_summary', summary: d.analysis?.transcript_summary ?? null, duration_secs: d.metadata?.call_duration_secs ?? null, termination: d.metadata?.termination_reason ?? null });
  return { status: 200, body: { ok: true, stored, signature_checked: !!secret } };
}
