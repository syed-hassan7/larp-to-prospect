// Dispatcher for the 3 ElevenLabs webhook tools. Guarded by x-internal-key at the API layer.
import { deckStateLogic } from './state.js';
import { askLogic } from './ask.js';
import { actLogic } from './act.js';
import type { HandlerResult } from './shared.js';

export async function toolLogic(name: string, body: any): Promise<HandlerResult> {
  body = body ?? {};
  switch (name) {
    case 'get_deck_state': return deckStateLogic(String(body.run_id ?? ''));
    case 'refilter': {
      const r = await askLogic({ run_id: String(body.run_id ?? ''), question: String(body.question ?? ''), mode: 'refilter', source: 'tool' });
      if (r.status !== 200) return r;
      // Keep the tool response small for the voice LLM.
      const { answer_text, matches, missing_fields, filters } = r.body;
      return { status: 200, body: { answer_text, filters: filters ?? null, matches: (matches ?? []).map((m: any) => ({ vendor: m.name, status: m.status, reason: m.reason, missing_field: m.missing_field ?? null })), missing_fields: missing_fields ?? [] } };
    }
    case 'act': return actLogic({ run_id: body.run_id, action: body.action, candidate_id: body.candidate_id, confirmed: body.confirmed });
    default: return { status: 404, body: { error: 'unknown_tool', known: ['get_deck_state', 'refilter', 'act'] } };
  }
}
