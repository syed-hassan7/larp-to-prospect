// Per-run budget guard. Adds cost to runs.cost_usd (atomic compare-and-swap over REST, safe for parallel
// callers and parallel Vercel invocations), emits cost_tick, and throws BudgetExceeded above BUDGET_USD.
import { sbSelect, sbPatch, emit, type LlmResult } from './core.js';

export const BUDGET_USD = 1.5;

export class BudgetExceeded extends Error {
  total: number;
  constructor(total: number) {
    super(`budget exceeded: run cost $${total.toFixed(4)} > $${BUDGET_USD.toFixed(2)}`);
    this.name = 'BudgetExceeded';
    this.total = total;
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const tails = new Map<string, Promise<unknown>>(); // in-process serialisation per run (cuts CAS contention)

async function doAdd(runId: string, usd: number): Promise<number> {
  for (let i = 0; i < 25; i++) {
    const [row] = await sbSelect<{ cost_usd: number | string }>('runs', `id=eq.${runId}&select=cost_usd`);
    if (!row) throw new Error(`addCost: run ${runId} not found`);
    const cur = round6(Number(row.cost_usd ?? 0));
    const next = round6(cur + usd);
    // compare-and-swap: only update if nobody changed cost_usd since we read it
    const upd = await sbPatch('runs', `id=eq.${runId}&cost_usd=eq.${cur}`, { cost_usd: next });
    if (upd.length) return next;
    await new Promise(r => setTimeout(r, 20 + Math.random() * 80));
  }
  throw new Error('addCost: could not update runs.cost_usd after 25 attempts (contention)');
}

/** Add `usd` to runs.cost_usd, emit cost_tick, throw BudgetExceeded when total > $1.50. Returns new total. */
export function addCost(runId: string, usd: number, nodeId = 'orchestrator', label = ''): Promise<number> {
  const prev = tails.get(runId) ?? Promise.resolve();
  const p = prev.catch(() => {}).then(async () => {
    const total = await doAdd(runId, usd);
    const over = total > BUDGET_USD;
    await emit(runId, nodeId, 'cost_tick', { delta_usd: round6(usd), total_usd: total, budget_usd: BUDGET_USD, label, over_budget: over }).catch(() => {});
    if (over) throw new BudgetExceeded(total);
    return total;
  });
  tails.set(runId, p.catch(() => {}));
  return p;
}

/** Convenience: charge an llm() result to the run. */
export const chargeLlm = (runId: string, nodeId: string, res: LlmResult, label = '') =>
  addCost(runId, res.cost_usd, nodeId, label || res.model);

/** Throw if the run is already over budget (call at phase start). */
export async function assertBudget(runId: string): Promise<number> {
  const [row] = await sbSelect<{ cost_usd: number | string }>('runs', `id=eq.${runId}&select=cost_usd`);
  const total = Number(row?.cost_usd ?? 0);
  if (total > BUDGET_USD) throw new BudgetExceeded(total);
  return total;
}
