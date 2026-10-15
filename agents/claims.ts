// Claim ledger: verbatim quote verification + persistence. A claim is only stored if its quote is a real substring
// of the text we fetched (whitespace / markdown / quote-style normalised on both sides). Otherwise claim_rejected.
import { sbInsert, emit } from '../lib/core.js';
import type { Channel, Claim } from './schemas.js';

/** Normalise for comparison: strip markdown links/images/emphasis/html, unify quotes+dashes, collapse whitespace, lowercase. */
export function normalizeText(s: string): string {
  return String(s ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[*_`#>|\\~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Case-insensitive, whitespace/markdown-normalised verbatim-substring check. */
export function verifyQuote(pageText: string, quote: string): boolean {
  const q = normalizeText(quote);
  if (q.length < 8) return false; // too short to be evidence
  return normalizeText(pageText).includes(q);
}

export interface ClaimInput {
  field: string; value: string; source_url: string; quote: string;
  confidence?: Claim['confidence']; source_type?: Claim['source_type']; channel?: Channel;
}
export type SaveResult = { ok: true; id: number } | { ok: false; reason: string };

const NON_ANSWER = /^(unknown|n\/a|none|not (stated|found|specified|available|mentioned|provided)|no (information|data))/i;

/** Verify the quote against pageText; insert into claims + emit claim_added, or emit claim_rejected with a reason. */
export async function saveClaim(o: {
  runId: string; candidateId: string; nodeId: string; parentId?: string | null; claim: ClaimInput; pageText: string;
}): Promise<SaveResult> {
  const { runId, candidateId, nodeId, parentId = null, claim: c, pageText } = o;
  const base = { candidate_id: candidateId, field: c.field, value: c.value, source_url: c.source_url, quote: c.quote };
  const reject = async (reason: string): Promise<SaveResult> => {
    await emit(runId, nodeId, 'claim_rejected', { ...base, reason }, parentId).catch(() => {});
    return { ok: false, reason };
  };
  if (!c.field || !c.value || !c.quote || !c.source_url) return reject('incomplete claim (field/value/quote/source_url required)');
  if (NON_ANSWER.test(c.value.trim())) return reject('value is a non-answer (unknown stays unknown, not stored as a claim)');
  if (!verifyQuote(pageText, c.quote)) return reject('quote not found verbatim in fetched page text');
  if (c.field === 'pricing') {
    // a price claim must have its figures present in the quote itself (stops "£9k" invented from a vague quote)
    const nums = (c.value.match(/\d[\d,.]*/g) ?? []).map(n => n.replace(/[,.]+$/, '').replace(/,/g, ''));
    const qn = c.quote.replace(/,/g, '');
    if (nums.length && !nums.some(n => qn.includes(n))) return reject(`pricing figure(s) ${nums.join('/')} in value do not appear in the quote`);
  }
  const row = {
    run_id: runId, candidate_id: candidateId, field: c.field, value: c.value, source_url: c.source_url, quote: c.quote,
    confidence: c.confidence ?? 'high', source_type: c.source_type ?? 'web', channel: c.channel ?? 'web',
  };
  const [ins] = await sbInsert<{ id: number }>('claims', row);
  await emit(runId, nodeId, 'claim_added', { ...base, claim_id: ins.id, confidence: row.confidence, source_type: row.source_type, channel: row.channel }, parentId).catch(() => {});
  return { ok: true, id: ins.id };
}
