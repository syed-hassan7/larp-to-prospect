// Phase: deconstruct. company doc -> CompanyProfile (role smart). hard_constraints carry ClaimField ids.
import { sbSelect, sbPatch, emit, llmJson, asData, env } from '../../lib/core.js';
import { chargeLlm, assertBudget } from '../../lib/budget.js';
import type { CompanyProfile } from '../schemas.js';

const SYSTEM = `You turn a company's vendor-requirements brief into a structured profile used by a research agent.
Return JSON with exactly these keys:
{
 "company": string, "one_liner": string, "need": string,
 "stack": string[],                       // tools they already run (AWS, GitHub, Okta...)
 "budget_cap_gbp": number|null,           // annual cap in GBP from the hard requirements, else null
 "deadline_days": number|null,
 "hard_constraints": [{"id": string, "text": string, "field": string}],
 "soft_prefs": string[], "out_of_scope": string[],
 "contact": {"name": string, "role": string, "email": string},   // only what the doc literally states; "" if absent
 "search_plan": string[]                  // 4-5 web search queries to discover candidate vendors (no vendor names you were not given)
}
Rules for hard_constraints (these are the DEALBREAKERS section of the doc, nothing else):
- One constraint per checkable fact. Split "native integrations with AWS, GitHub and Okta" into THREE constraints.
- id: short snake_case (budget, residency, soc2_type2, int_aws, int_github, int_okta, public_pricing ...).
- field MUST be one of: pricing | data_residency | soc2_type2 | integration_aws | integration_github | integration_okta | auditor_marketplace | or a new snake_case field if none fits.
  Cost cap -> pricing. UK/EU storage -> data_residency. SOC 2 Type II -> soc2_type2. "No sales call to learn pricing" -> public_pricing with field pricing.
- text: the requirement in plain words, including the numbers (e.g. "Total annual cost under £15,000").
out_of_scope: short phrases of vendor types to exclude. search_plan queries must be natural web-search queries aimed at finding product vendors for the need
(include a year-agnostic phrasing, UK/startup context, and one "alternatives to <well-known category leader>" style query only if the doc names none: otherwise skip it).`;

export async function run(runId: string, _args: Record<string, any> = {}): Promise<void> {
  const node = 'deconstruct';
  await emit(runId, node, 'node_started', { role: 'smart' }, 'orchestrator');
  try {
    await assertBudget(runId);
    const [row] = await sbSelect<{ doc_text: string }>('runs', `id=eq.${runId}&select=doc_text`);
    if (!row) throw new Error(`run ${runId} not found`);
    await sbPatch('runs', `id=eq.${runId}`, { status: 'researching' });
    await emit(runId, node, 'tool_call', { tool: 'llm', role: 'smart', purpose: 'doc -> CompanyProfile' }, 'orchestrator');

    const { data, res } = await llmJson<CompanyProfile>({
      role: 'smart', system: SYSTEM, maxTokens: 3000,
      user: `Company brief to deconstruct:\n${asData('company_doc', row.doc_text, 20000)}`,
    });
    await chargeLlm(runId, node, res, 'deconstruct');

    const ids = new Set<string>();
    const hard = (data.hard_constraints ?? []).map((h, i) => {
      let id = String(h.id || `c${i + 1}`).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      while (ids.has(id)) id += '_2';
      ids.add(id);
      return { id, text: String(h.text ?? ''), field: String(h.field || 'other') };
    }).filter(h => h.text);
    if (!hard.length) throw new Error('deconstruct produced no hard_constraints');
    if (!data.search_plan?.length) throw new Error('deconstruct produced no search_plan');

    const envEmail = env('CONTACT_EMAIL', false);
    const profile: CompanyProfile = {
      company: data.company, one_liner: data.one_liner, need: data.need,
      stack: data.stack ?? [], budget_cap_gbp: data.budget_cap_gbp ?? null, deadline_days: data.deadline_days ?? null,
      hard_constraints: hard, soft_prefs: data.soft_prefs ?? [], out_of_scope: data.out_of_scope ?? [],
      contact: { name: data.contact?.name ?? '', role: data.contact?.role ?? '', email: envEmail || data.contact?.email || '' },
      search_plan: data.search_plan.slice(0, 6),
    };
    await sbPatch('runs', `id=eq.${runId}`, { profile });
    await emit(runId, node, 'node_done', {
      company: profile.company, hard_constraints: hard.map(h => `${h.id}:${h.field}`), search_queries: profile.search_plan.length,
      budget_cap_gbp: profile.budget_cap_gbp,
    }, 'orchestrator');
  } catch (e: any) {
    await emit(runId, node, 'node_failed', { reason: String(e?.message ?? e).slice(0, 300) }, 'orchestrator').catch(() => {});
    throw e;
  }
}
