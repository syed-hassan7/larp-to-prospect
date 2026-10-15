// Live proof for stream C. Run: npx tsx --env-file=.env scripts/test-voice.ts
// Everything seeded here is a hand-made TEST ledger named "stream-c-test"; it is deleted at the end and is NOT research.
import { createHmac } from 'node:crypto';
import { env, sbInsert, sbSelect, sbDelete, rpc } from '../lib/core.js';
import { el, pickVoice } from '../agents/voice/shared.js';
import { createOrUpdateAgent } from './create-agent.js';
import { narrateDeck } from '../agents/narrate.js';
import { askLogic } from '../agents/voice/ask.js';
import { toolLogic } from '../agents/voice/tool.js';
import { actLogic } from '../agents/voice/act.js';
import { callLogic } from '../agents/voice/call.js';
import { webhookLogic, verifySignature } from '../agents/voice/webhook.js';
import toolHandler from '../api/voice/tool/[name].js';
import type { Deck } from '../agents/schemas.js';

const hr = (s: string) => console.log(`\n===== ${s} =====`);
const show = (o: any, n = 900) => console.log(JSON.stringify(o, null, 1).slice(0, n));
let runId = '';
try {
  hr('1. agent create/update');
  const { agentId, voice, placeholder } = await createOrUpdateAgent();
  console.log('RESULT agent_id=', agentId, '| voice=', voice.name, '| placeholder_tool_urls=', placeholder);

  hr('2. narration: 2-slide test deck -> Supabase Storage bucket "audio"');
  const deck: Deck = { run_id: 'stream-c-test', version: 1, slides: [
    { id: 's1', kind: 'verdict', title: 'TEST verdict', body: {}, narration: 'This is a stream C narration test. TEST Vendor Alpha qualifies on the hand-made test ledger. This is not real research.' },
    { id: 's2', kind: 'risks', title: 'TEST risks', body: {}, narration: 'Second test slide. One gap is open: the employee count for TEST Vendor Gamma is unknown, so we are asking the vendor.' },
  ] };
  const { deck: nd, stats } = await narrateDeck(deck, { prefix: 'stream-c-test' });
  console.log('stats', JSON.stringify(stats));
  for (const s of nd.slides) {
    const r = await fetch(s.audio_url!);
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`${s.id}: ${s.audio_url}\n   HTTP ${r.status} content-type=${r.headers.get('content-type')} bytes=${buf.length} mp3-header=${buf.subarray(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)}`);
  }

  hr('3. seed stream-c-test run (hand-made ledger)');
  const [run] = await sbInsert('runs', {
    doc_text: 'STREAM-C-TEST: hand-made test ledger for voice layer verification. NOT real research.', status: 'deck_ready',
    profile: { company: 'Acme Solutions (stream-c-test)', one_liner: 'test', need: 'TEST need: compliance tooling', stack: [], budget_cap_gbp: 15000, deadline_days: 90,
      hard_constraints: [{ id: 'residency', text: 'Data hosted in UK/EU', field: 'data_residency' }], soft_prefs: [], out_of_scope: [], contact: { name: 'Priya Nair', role: 'Founder', email: 'acme.procurement.demo@gmail.com' }, search_plan: [] },
    candidates: [ { id: 'test-alpha', name: 'TEST Vendor Alpha', url: 'https://alpha.test.invalid', why: 'test' }, { id: 'test-beta', name: 'TEST Vendor Beta', url: 'https://beta.test.invalid', why: 'test' }, { id: 'test-gamma', name: 'TEST Vendor Gamma', url: 'https://gamma.test.invalid', why: 'test' } ],
    verdicts: { 'test-alpha': { candidate_id: 'test-alpha', verdict: 'qualified', cells: { residency: { cell: 'pass', claim_ids: [] } }, risks: [], score: 80 }, 'test-beta': { candidate_id: 'test-beta', verdict: 'disqualified', cells: { residency: { cell: 'fail', claim_ids: [] } }, disqualified_because: 'US-only hosting', risks: [], score: 10 }, 'test-gamma': { candidate_id: 'test-gamma', verdict: 'unverified', cells: { residency: { cell: 'pass', claim_ids: [] } }, risks: [], score: 55 } },
    gaps: [{ candidate_id: 'test-gamma', field: 'employee_count', why_it_matters: 'TEST: size filter', flips_verdict: false, best_channel: 'email' }],
  });
  runId = run.id; console.log('run', runId);
  await sbInsert('claims', [
    { run_id: runId, candidate_id: 'test-alpha', field: 'data_residency', value: 'Hosted in London (UK) only', source_url: 'https://alpha.test.invalid/security', quote: 'All customer data is hosted in London, UK.', confidence: 'high', source_type: 'web', channel: 'web' },
    { run_id: runId, candidate_id: 'test-alpha', field: 'employee_count', value: '35 employees', source_url: 'https://alpha.test.invalid/about', quote: 'We are a team of 35.', confidence: 'high', source_type: 'web', channel: 'web' },
    { run_id: runId, candidate_id: 'test-beta', field: 'data_residency', value: 'US-only hosting (us-east-1)', source_url: 'https://beta.test.invalid/trust', quote: 'Data is stored in the US only.', confidence: 'high', source_type: 'web', channel: 'web' },
    { run_id: runId, candidate_id: 'test-beta', field: 'employee_count', value: '420 employees', source_url: 'https://beta.test.invalid/about', quote: 'Over 400 people work here.', confidence: 'high', source_type: 'web', channel: 'web' },
    { run_id: runId, candidate_id: 'test-gamma', field: 'data_residency', value: 'UK and EU regions available', source_url: 'https://gamma.test.invalid/security', quote: 'Choose UK or EU hosting.', confidence: 'high', source_type: 'web', channel: 'web' },
  ]);

  hr('4. api/ask logic (real LLM): "what if we only want UK-hosted vendors under 50 staff"');
  const a = await askLogic({ run_id: runId, question: 'what if we only want UK-hosted vendors under 50 staff', mode: 'refilter', source: 'ask' });
  console.log('status', a.status); console.log('answer_text:', a.body.answer_text); console.log('matches:', JSON.stringify(a.body.matches?.map((m: any) => ({ v: m.name, s: m.status, ids: m.claim_ids, missing: m.missing_field })))); console.log('missing_fields:', a.body.missing_fields, '| patch slide:', a.body.patch?.[0]?.kind);
  const b = await askLogic({ run_id: runId, question: 'How much does TEST Vendor Alpha cost per year?' });
  console.log('price question ->', b.status, b.body.answer_text);
  const evs = await sbSelect('run_events', `run_id=eq.${runId}&type=eq.voice_turn&select=payload`);
  console.log('voice_turn events emitted:', evs.length);
  const cost = (await sbSelect('runs', `id=eq.${runId}&select=cost_usd`))[0].cost_usd; console.log('run cost_usd after 2 asks:', cost);

  hr('5. tool dispatcher (get_deck_state) + HTTP guard');
  const ds = await toolLogic('get_deck_state', { run_id: runId });
  console.log('get_deck_state', ds.status, 'vendors=', ds.body.vendors?.length, 'claims alpha=', ds.body.vendors?.[0]?.claims?.length, 'open_gaps=', ds.body.open_gaps?.length);
  const fake = (headers: any, body: any, name = 'get_deck_state') => new Promise<any>(resolve => { const res: any = { _h: {}, setHeader() {}, status(c: number) { this.code = c; return this; }, json(o: any) { resolve({ code: this.code, o }); }, end() { resolve({ code: this.code }); } }; toolHandler({ method: 'POST', headers, query: { name }, body }, res); });
  const noKey = await fake({}, { run_id: runId }); const withKey = await fake({ 'x-internal-key': env('INTERNAL_API_KEY') }, { run_id: runId });
  console.log('api/voice/tool/get_deck_state without key ->', noKey.code, '| with key ->', withKey.code, 'vendors=', withKey.o?.vendors?.length);

  hr('6. act: confirmation gate + one real book_demo + duplicate suppression');
  for (const c of [undefined, false, 'true', 1]) { const r = await actLogic({ run_id: runId, action: 'book_demo', candidate_id: 'test-alpha', confirmed: c as any }); console.log(`confirmed=${JSON.stringify(c)} ->`, r.status, r.body.error); }
  const dq = await actLogic({ run_id: runId, action: 'book_demo', candidate_id: 'test-beta', confirmed: true }); console.log('disqualified vendor ->', dq.status, dq.body.error);
  const ok = await actLogic({ run_id: runId, action: 'book_demo', candidate_id: 'test-alpha', confirmed: true }); console.log('confirmed=true ->', ok.status, JSON.stringify(ok.body).slice(0, 260));
  const dup = await actLogic({ run_id: runId, action: 'book_demo', candidate_id: 'test-alpha', confirmed: true }); console.log('repeat within 5 min ->', dup.status, 'duplicate=', dup.body.duplicate);
  const sent = await sbSelect('run_events', `run_id=eq.${runId}&type=eq.outreach_sent&select=node_id,payload`); console.log('outreach_sent events:', sent.length, sent[0]?.node_id, sent[0]?.payload?.to);

  hr('7. call handler with no phone number configured');
  const c = await callLogic({ run_id: runId, to_number: '+447700900123' }); console.log('status', c.status, JSON.stringify(c.body));

  hr('8. post-call webhook (self-signed test secret; proves MY verifier + storage, not ElevenLabs delivery)');
  process.env.ELEVENLABS_WEBHOOK_SECRET = 'test-secret-not-real';
  const payload = JSON.stringify({ type: 'post_call_transcription', event_timestamp: Math.floor(Date.now() / 1000), data: { agent_id: agentId, conversation_id: 'conv_stream_c_test', transcript: [ { role: 'agent', message: 'TEST turn from agent', tool_calls: [], time_in_call_secs: 0 }, { role: 'user', message: 'TEST turn from user', time_in_call_secs: 3 } ], metadata: { call_duration_secs: 5 }, analysis: { transcript_summary: 'test' }, conversation_initiation_client_data: { dynamic_variables: { run_id: runId } } } });
  const t = Math.floor(Date.now() / 1000); const sig = `t=${t},v0=` + createHmac('sha256', 'test-secret-not-real').update(`${t}.${payload}`).digest('hex');
  console.log('bad signature ->', (await webhookLogic(payload, `t=${t},v0=deadbeef`)).status, '| no header ->', (await webhookLogic(payload, undefined)).status);
  const good = await webhookLogic(payload, sig); console.log('good signature ->', good.status, JSON.stringify(good.body));
  const again = await webhookLogic(payload, sig); console.log('redelivery ->', again.status, JSON.stringify(again.body));
  delete process.env.ELEVENLABS_WEBHOOK_SECRET;

  hr('9. ElevenLabs simulate-conversation (tool URLs are placeholders -> tools MOCKED; tests prompt behaviour only)');
  const mockState = JSON.stringify({ run_id: runId, company: 'Acme Solutions', vendors: [ { candidate_id: 'test-alpha', name: 'TEST Vendor Alpha', verdict: 'qualified', claims: [ { id: 1, field: 'data_residency', value: 'Hosted in London (UK) only', source: 'alpha.test.invalid' } ] } ], open_gaps: [], note: 'No pricing claims exist for any vendor.' });
  const sim = await el<any>('POST', `/v1/convai/agents/${agentId}/simulate-conversation`, {
    simulation_specification: {
      simulated_user_config: { first_message: '', language: 'en', prompt: { prompt: 'You are Priya Nair, a busy founder. Turn 1: ask exactly how much TEST Vendor Alpha costs per year in pounds. Turn 2: whatever the analyst says, reply "ok, book the demo with Alpha". Turn 3: if the analyst asks you to confirm, say "yes, go ahead". Keep every reply under 15 words.', llm: 'gpt-4o', temperature: 0 } },
      dynamic_variables: { run_id: runId, company: 'Acme Solutions', top_pick: 'TEST Vendor Alpha', summary: 'TEST Vendor Alpha qualifies. TEST Vendor Beta is ruled out.' },
      tool_mock_config: { get_deck_state: { default_return_value: mockState }, act: { default_return_value: '{"ok":true,"queued":true,"message":"Queued in demo mode."}' }, refilter: { default_return_value: '{"answer_text":"mock"}' } },
    }, new_turns_limit: 14,
  });
  console.log('simulate status', sim.status);
  if (sim.status === 200) {
    for (const m of sim.data.simulated_conversation) {
      const calls = (m.tool_calls ?? []).map((x: any) => `${x.tool_name}(${String(x.params_as_json).slice(0, 120)})`).join('; ');
      if (m.message || calls) console.log(`  ${m.role}: ${String(m.message ?? '').replace(/\s+/g, ' ').slice(0, 260)}${calls ? ' [TOOL ' + calls + ']' : ''}`);
    }
  } else console.log(sim.text.slice(0, 500));
} catch (e: any) { console.error('TEST FAILED:', e.stack?.split('\n').slice(0, 4).join('\n') ?? e); process.exitCode = 1; }
finally {
  if (runId) { await sbDelete('runs', `id=eq.${runId}`); console.log('\ncleanup: deleted stream-c-test run', runId, '(claims/events cascade). remaining:', (await sbSelect('runs', `id=eq.${runId}&select=id`)).length); }
  // test mp3s under audio/stream-c-test/ are left in place so the printed URLs stay checkable (hash-named, ~2 tiny files)
}
