// get_deck_state tool logic: compact, citation-ready snapshot of the run for the voice agent. No LLM.
import { loadRun, nameOf, host, type HandlerResult } from './shared.js';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function deckStateLogic(runId: string): Promise<HandlerResult> {
  const b = await loadRun(runId);
  if (!b) return { status: 404, body: { error: 'run_not_found', message: 'No run with that id. The briefing may not be loaded.' } };
  const vendors = b.candidates.map(c => {
    const v = b.verdicts[c.id];
    const claims = b.claims.filter(x => x.candidate_id === c.id).slice(0, 14).map(x => ({
      id: x.id, field: x.field, value: clip(String(x.value), 140), source: host(x.source_url), channel: x.channel, from: x.source_type, confidence: x.confidence,
    }));
    return {
      candidate_id: c.id, name: nameOf(b, c.id),
      verdict: v?.verdict ?? 'no_verdict_yet', score: v?.score ?? null,
      disqualified_because: v?.disqualified_because ?? null,
      cells: Object.fromEntries(Object.entries(v?.cells ?? {}).map(([k, x]: any) => [k, x.cell + (x.note ? ` (${clip(x.note, 80)})` : '')])),
      risks: (v?.risks ?? []).slice(0, 3).map((r: string) => clip(r, 100)),
      claims,
    };
  });
  return { status: 200, body: {
    run_id: b.run.id, status: b.run.status, company: b.run.profile?.company ?? null,
    hard_constraints: (b.run.profile?.hard_constraints ?? []).map((c: any) => ({ id: c.id, text: c.text })),
    budget_cap_gbp: b.run.profile?.budget_cap_gbp ?? null,
    vendors,
    open_gaps: b.gaps.map((g: any) => ({ candidate_id: g.candidate_id, field: g.field, why: clip(g.why_it_matters ?? '', 120), could_flip_verdict: g.flips_verdict, being_chased_via: g.best_channel })),
    outreach: b.outreach.map((o: any) => ({ candidate_id: o.candidate_id, channel: o.channel, status: o.status, sandbox: o.sandbox, got_reply: !!o.reply_text })),
    note: 'Cite sources by the "source" name. Fields not listed for a vendor are unknown. Never invent values.',
  } };
}
