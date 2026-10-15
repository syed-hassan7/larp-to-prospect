// Create (or update, if ELEVENLABS_AGENT_ID is set) the ONE ElevenLabs conversational agent + its 3 webhook tools.
// Run: npx tsx --env-file=.env scripts/create-agent.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { env } from '../lib/core.js';
import { el, pickVoice, PLACEHOLDER_HOST } from '../agents/voice/shared.js';
import { toolConfigs, agentConfig, TOOL_NAMES } from '../agents/voice/agentConfig.js';

export function setEnvVar(name: string, value: string, file = '.env') {
  const raw = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const i = lines.findIndex(l => l.startsWith(name + '='));
  if (i >= 0) lines[i] = `${name}=${value}`; else { if (lines[lines.length - 1] === '') lines.pop(); lines.push(`${name}=${value}`, ''); }
  writeFileSync(file, lines.join(nl));
}

/** Upsert the 3 workspace tools by name; returns tool ids in TOOL_NAMES order. */
export async function upsertTools(baseUrl: string): Promise<string[]> {
  const cfgs = toolConfigs(baseUrl);
  const list = await el<any>('GET', '/v1/convai/tools?page_size=100');
  if (list.status !== 200) throw new Error(`list tools -> ${list.status} ${list.text.slice(0, 300)}`);
  const existing: any[] = list.data.tools ?? [];
  const ids: string[] = [];
  for (const name of TOOL_NAMES) {
    const found = existing.find(t => t.tool_config?.name === name);
    const r = found
      ? await el<any>('PATCH', `/v1/convai/tools/${found.id}`, { tool_config: cfgs[name] })
      : await el<any>('POST', '/v1/convai/tools', { tool_config: cfgs[name] });
    if (r.status !== 200) throw new Error(`${found ? 'update' : 'create'} tool ${name} -> ${r.status} ${r.text.slice(0, 600)}`);
    ids.push(found ? found.id : r.data.id);
    console.log(`tool ${name}: ${found ? 'updated' : 'created'} ${ids[ids.length - 1]}`);
  }
  return ids;
}

async function main() {
  env('ELEVENLABS_API_KEY');
  const voice = await pickVoice();
  console.log(`voice: ${voice.name} (${voice.voice_id}, ${voice.accent})`);
  const base = process.env.PUBLIC_BASE_URL || PLACEHOLDER_HOST;
  const placeholder = !process.env.PUBLIC_BASE_URL;
  if (placeholder) console.log(`PUBLIC_BASE_URL empty -> tool URLs use PLACEHOLDER host ${PLACEHOLDER_HOST}; run scripts/update-agent-urls.ts after deploy`);
  const toolIds = await upsertTools(base);
  const body = agentConfig(toolIds, voice);
  // .env can be clobbered by other scripts: fall back to finding our agent by name so we never create duplicates.
  let existingId = process.env.ELEVENLABS_AGENT_ID || '';
  if (!existingId) {
    const l = await el<any>('GET', '/v1/convai/agents?page_size=100&search=Larp%20To%20Prospect');
    const hit = (l.data?.agents ?? []).find((a: any) => a.name === 'Larp To Prospect - The Analyst');
    if (hit) { existingId = hit.agent_id; setEnvVar('ELEVENLABS_AGENT_ID', existingId); process.env.ELEVENLABS_AGENT_ID = existingId; console.log('found existing agent by name, restored ELEVENLABS_AGENT_ID in .env'); }
  }
  let agentId = existingId;
  if (existingId) {
    const r = await el('PATCH', `/v1/convai/agents/${existingId}`, body);
    if (r.status !== 200) throw new Error(`update agent -> ${r.status} ${r.text.slice(0, 800)}`);
    console.log('agent updated', existingId);
  } else {
    const r = await el<any>('POST', '/v1/convai/agents/create', body);
    if (r.status !== 200) throw new Error(`create agent -> ${r.status} ${r.text.slice(0, 800)}`);
    agentId = r.data.agent_id;
    setEnvVar('ELEVENLABS_AGENT_ID', agentId);
    process.env.ELEVENLABS_AGENT_ID = agentId;
    console.log('agent created', agentId, '(saved to .env as ELEVENLABS_AGENT_ID)');
  }
  const g = await el<any>('GET', `/v1/convai/agents/${agentId}`);
  const c = g.data?.conversation_config, p = g.data?.platform_settings;
  console.log('readback:', JSON.stringify({ status: g.status, name: g.data?.name, llm: c?.agent?.prompt?.llm, tts_model: c?.tts?.model_id, voice_id: c?.tts?.voice_id, tool_ids: c?.agent?.prompt?.tool_ids?.length, enable_auth: p?.auth?.enable_auth, allowlist: p?.auth?.allowlist?.length ?? 0, turn_eagerness: c?.turn?.turn_eagerness }));
  console.log(`widget: <elevenlabs-convai agent-id="${agentId}" dynamic-variables='{"run_id":"<uuid>","company":"...","top_pick":"...","summary":"..."}'></elevenlabs-convai>`);
  return { agentId, voice, toolIds, placeholder };
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/create-agent.ts')) main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
export { main as createOrUpdateAgent };
