// Pre-render slide narration with ElevenLabs TTS -> public Supabase Storage bucket "audio" -> slide.audio_url.
// Budget: account has 131,000 chars; each narration is capped at ~600 chars; identical text+voice+model is never re-synthesised (content-hashed path).
import { createHash } from 'node:crypto';
import { env, sbSelect, sbPatch } from '../lib/core.js';
import { elKey, pickVoice } from './voice/shared.js';
import type { Deck } from './schemas.js';

export const NARRATION_MODEL = 'eleven_v4_turbo';
const FALLBACK_MODEL = 'eleven_flash_v2_5';
export const MAX_NARRATION_CHARS = 600;
const CONCURRENCY = 4;
const BUCKET = 'audio';

export interface NarrateStats { slides: number; synthesised: number; reused: number; skipped: number; chars_used: number; bytes: number; model: string; voice: string; failures: { slide: string; error: string }[] }

const sbStorage = (path: string, init: RequestInit = {}) =>
  fetch(env('SUPABASE_URL') + '/storage/v1' + path, { ...init, headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, ...(init.headers as any) } });

let bucketReady = false;
export async function ensureAudioBucket(): Promise<'existing' | 'created'> {
  const g = await sbStorage(`/bucket/${BUCKET}`);
  if (g.ok) { const j: any = await g.json(); if (!j.public) await sbStorage(`/bucket/${BUCKET}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ public: true }) }); bucketReady = true; return 'existing'; }
  const c = await sbStorage('/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }) });
  if (!c.ok) throw new Error(`create bucket ${BUCKET} -> ${c.status} ${(await c.text()).slice(0, 200)}`);
  bucketReady = true; return 'created';
}

/** Trim to <= max chars at a sentence boundary (spoken text, so no markdown). */
export function capNarration(text: string, max = MAX_NARRATION_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '.';
}

async function tts(voiceId: string, text: string, model: string): Promise<{ status: number; buf?: Buffer; err?: string }> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': elKey(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!res.ok) return { status: res.status, err: (await res.text()).slice(0, 300) };
  return { status: 200, buf: Buffer.from(await res.arrayBuffer()) };
}

export async function narrateDeck(deck: Deck, opts: { prefix?: string; log?: (s: string) => void } = {}): Promise<{ deck: Deck; stats: NarrateStats }> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const voice = await pickVoice();
  if (!bucketReady) await ensureAudioBucket();
  const prefix = opts.prefix ?? `${deck.run_id}/v${deck.version}`;
  const pub = (p: string) => `${env('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/${p}`;
  const stats: NarrateStats = { slides: deck.slides.length, synthesised: 0, reused: 0, skipped: 0, chars_used: 0, bytes: 0, model: NARRATION_MODEL, voice: voice.name, failures: [] };
  const slides = deck.slides.map(s => ({ ...s }));
  let model = NARRATION_MODEL;

  let next = 0;
  async function worker() {
    while (next < slides.length) {
      const s = slides[next++];
      const text = capNarration(String(s.narration ?? ''));
      if (!text) { stats.skipped++; continue; }
      const hash = createHash('sha1').update(`${voice.voice_id}|${model}|${text}`).digest('hex').slice(0, 10);
      const path = `${prefix}/${s.id.replace(/[^a-z0-9_-]/gi, '_')}-${hash}.mp3`;
      try {
        const head = await fetch(pub(path), { method: 'HEAD' });
        if (head.ok) { s.audio_url = pub(path); stats.reused++; continue; }
        let r = await tts(voice.voice_id, text, model);
        if (r.status === 400 || r.status === 422) { // model rejected: fall back once for the whole run
          log(`  model ${model} -> ${r.status} ${r.err}; falling back to ${FALLBACK_MODEL}`);
          model = FALLBACK_MODEL; stats.model = model; r = await tts(voice.voice_id, text, model);
        }
        if (!r.buf) throw new Error(`tts ${r.status} ${r.err}`);
        stats.chars_used += text.length; stats.bytes += r.buf.length;
        const up = await sbStorage(`/object/${BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'audio/mpeg', 'x-upsert': 'true', 'cache-control': '31536000' }, body: r.buf as any });
        if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 200)}`);
        s.audio_url = pub(path); stats.synthesised++;
        log(`  slide ${s.id}: ${text.length} chars -> ${r.buf.length} bytes`);
      } catch (e: any) { stats.failures.push({ slide: s.id, error: String(e.message ?? e).slice(0, 200) }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slides.length) }, worker));
  log(`narrate: ${stats.synthesised} synthesised, ${stats.reused} reused, ${stats.skipped} skipped, ${stats.failures.length} failed; characters used this call: ${stats.chars_used} (model ${stats.model}, voice ${voice.name})`);
  return { deck: { ...deck, slides }, stats };
}

/** Narrate runs.deck in place (reads deck, writes slide.audio_url back). */
export async function narrateRun(runId: string): Promise<NarrateStats> {
  const [row] = await sbSelect('runs', `id=eq.${runId}&select=deck`);
  if (!row?.deck) throw new Error(`run ${runId} has no deck yet`);
  const { deck, stats } = await narrateDeck(row.deck as Deck);
  await sbPatch('runs', `id=eq.${runId}`, { deck });
  return stats;
}
