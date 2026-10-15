// Outbound phone call via ElevenLabs + Twilio. Returns 503 phone_not_configured when no phone number is imported (UI falls back to browser widget).
import { emit } from '../../lib/core.js';
import { el, loadRun, buildBriefing, type HandlerResult } from './shared.js';

export async function callLogic(inp: { run_id?: string; to_number?: string }): Promise<HandlerResult> {
  const phoneId = process.env.ELEVENLABS_PHONE_NUMBER_ID ?? '';
  const agentId = process.env.ELEVENLABS_AGENT_ID ?? '';
  if (!phoneId) return { status: 503, body: { error: 'phone_not_configured', message: 'No phone number is imported into ElevenLabs (ELEVENLABS_PHONE_NUMBER_ID is empty). Use the browser widget with the same agent instead.', fallback: 'browser_widget', agent_id: agentId || null } };
  if (!agentId) return { status: 503, body: { error: 'agent_not_configured', message: 'ELEVENLABS_AGENT_ID is empty; run scripts/create-agent.ts.' } };
  if (!inp.run_id) return { status: 400, body: { error: 'bad_request', message: 'run_id is required' } };
  const to = String(inp.to_number || process.env.FOUNDER_PHONE_NUMBER || '').replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return { status: 400, body: { error: 'bad_to_number', message: 'to_number must be E.164, for example +447700900123 (or set FOUNDER_PHONE_NUMBER).' } };
  const b = await loadRun(inp.run_id);
  if (!b) return { status: 404, body: { error: 'run_not_found' } };
  const vars = buildBriefing(b);
  const r = await el<any>('POST', '/v1/convai/twilio/outbound-call', {
    agent_id: agentId, agent_phone_number_id: phoneId, to_number: to,
    conversation_initiation_client_data: { dynamic_variables: vars },
  });
  if (r.status !== 200 || r.data?.success === false) {
    await emit(b.run.id, 'voice', 'voice_turn', { source: 'call', event: 'call_failed', status: r.status, detail: r.text.slice(0, 300) }).catch(() => {});
    return { status: 502, body: { error: 'call_failed', status: r.status, detail: r.text.slice(0, 500) } };
  }
  await emit(b.run.id, 'voice', 'voice_turn', { source: 'call', event: 'call_started', conversation_id: r.data.conversation_id ?? null, call_sid: r.data.callSid ?? null, to_last4: to.slice(-4) }).catch(() => {});
  return { status: 200, body: { conversation_id: r.data.conversation_id ?? null, call_sid: r.data.callSid ?? null, success: true } };
}
