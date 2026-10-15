// Side-effecting voice/UI actions. Refuses unless confirmed === true. Demo mode: all email goes to the Acme demo inbox.
import { env, sbSelect, sbPatch, emit } from '../../lib/core.js';
import { loadRun, nameOf, DEMO_INBOX, type HandlerResult } from './shared.js';

export interface ActIn { run_id: string; action: 'book_demo' | 'send_outreach'; candidate_id: string; confirmed: boolean }
const AI_DISCLOSURE = 'This message was written and sent by an AI agent acting for Acme Solutions (procurement assistant), not by a person.';

async function queueEmail(subject: string, text: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(env('N8N_SEND_EMAIL_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': env('INTERNAL_API_KEY') },
    body: JSON.stringify({ to: DEMO_INBOX, subject, text }),
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 300) };
}

export async function actLogic(inp: Partial<ActIn> & Record<string, any>): Promise<HandlerResult> {
  if (inp.confirmed !== true) return { status: 400, body: { error: 'confirmation_required', message: 'Refused: confirmed must be strictly true. Read the action back to the founder and get a spoken yes first.' } };
  if (inp.action !== 'book_demo' && inp.action !== 'send_outreach') return { status: 400, body: { error: 'bad_action', message: "action must be 'book_demo' or 'send_outreach'" } };
  if (!inp.run_id || !inp.candidate_id) return { status: 400, body: { error: 'bad_request', message: 'run_id and candidate_id are required' } };
  const b = await loadRun(inp.run_id);
  if (!b) return { status: 404, body: { error: 'run_not_found' } };
  const cand = b.candidates.find(c => c.id === inp.candidate_id);
  if (!cand) return { status: 404, body: { error: 'candidate_not_found', message: `Unknown vendor id "${inp.candidate_id}". Known: ${b.candidates.map(c => c.id).join(', ') || 'none'}` } };
  const v = b.verdicts[cand.id];
  const company = b.run.profile?.company ?? 'Acme Solutions';
  const contact = b.run.profile?.contact ?? {};
  const node = `outreach:${cand.id}:${inp.action === 'book_demo' ? 'demo' : 'email'}`;

  // Idempotency: voice LLMs can double-fire tools. Same action+vendor within 5 minutes returns the first result.
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const dup = await sbSelect('run_events', `run_id=eq.${b.run.id}&node_id=eq.${encodeURIComponent(node)}&type=eq.outreach_sent&ts=gte.${since}&select=id,payload&limit=1`);
  if (dup.length) return { status: 200, body: { ok: true, queued: true, duplicate: true, action: inp.action, candidate_id: cand.id, message: 'Already queued a minute ago; not sending again.' } };

  let subject: string, text: string, outreachRowId: number | undefined;
  if (inp.action === 'book_demo') {
    if (v?.verdict === 'disqualified') return { status: 409, body: { error: 'candidate_disqualified', message: `${nameOf(b, cand.id)} is ruled out (${v.disqualified_because ?? 'see verdict'}). Not booking a demo.` } };
    subject = `[DEMO MODE] Demo request for ${nameOf(b, cand.id)} (intended vendor: ${nameOf(b, cand.id)}) from ${company}`;
    text = `Hello,\n\nWe would like to book a demo of ${nameOf(b, cand.id)} for ${company}.\n${b.run.profile?.need ? 'Need: ' + b.run.profile.need + '\n' : ''}${contact.name ? 'Contact: ' + contact.name + (contact.role ? ' (' + contact.role + ')' : '') + '\n' : ''}Preferred: a 30 minute walkthrough in the next two weeks.\n\n${AI_DISCLOSURE}\n\n[Demo mode: this was redirected to the Acme demo inbox; intended vendor: ${nameOf(b, cand.id)} (${cand.url ?? 'no url'}).]\n`;
  } else {
    const row = [...b.outreach].reverse().find(o => o.candidate_id === cand.id && o.channel === 'email' && o.message && ['planned', 'filled'].includes(o.status));
    if (!row) return { status: 409, body: { error: 'no_prepared_outreach', message: `There is no prepared, unsent email outreach for ${nameOf(b, cand.id)} in this run.` } };
    outreachRowId = row.id;
    subject = `[DEMO MODE] Outreach to ${nameOf(b, cand.id)} (intended vendor: ${nameOf(b, cand.id)}) from ${company}`;
    text = `${row.message}\n\n${AI_DISCLOSURE}\n\n[Demo mode: redirected to the Acme demo inbox; intended recipient: ${row.target ?? nameOf(b, cand.id)}.]\n`;
  }

  const r = await queueEmail(subject, text);
  if (!r.ok) {
    await emit(b.run.id, node, 'outreach_blocked', { action: inp.action, candidate_id: cand.id, error: `n8n ${r.status}`, detail: r.body }).catch(() => {});
    return { status: 502, body: { error: 'email_queue_failed', message: `Email workflow returned ${r.status}`, detail: r.body } };
  }
  if (outreachRowId) await sbPatch('outreach', `id=eq.${outreachRowId}`, { status: 'sent' }).catch(() => {});
  await emit(b.run.id, node, 'outreach_sent', { action: inp.action, candidate_id: cand.id, channel: 'email', to: DEMO_INBOX, demo_mode: true, intended_vendor: nameOf(b, cand.id), subject, via: 'voice_or_ui_act', n8n_status: r.status });
  return { status: 200, body: { ok: true, queued: true, action: inp.action, candidate_id: cand.id, vendor: nameOf(b, cand.id), delivered_to: DEMO_INBOX, demo_mode: true, message: `Queued. In demo mode the email goes to the Acme demo inbox with ${nameOf(b, cand.id)} as the intended vendor.` } };
}
