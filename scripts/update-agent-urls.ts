// After deploy: point the agent's 3 webhook tools at PUBLIC_BASE_URL. Run: npx tsx --env-file=.env scripts/update-agent-urls.ts
import { readFileSync, existsSync } from 'node:fs';
import { el } from '../agents/voice/shared.js';
import { toolConfigs, TOOL_NAMES } from '../agents/voice/agentConfig.js';

// Usage: npx tsx --env-file=.env scripts/update-agent-urls.ts [https://your-app.vercel.app]
// Pitfall: node --env-file never overrides vars already exported (even empty) in the shell, so also read .env directly.
const fromFile = existsSync('.env') ? (readFileSync('.env', 'utf8').match(/^PUBLIC_BASE_URL=(.*)$/m)?.[1] ?? '').trim() : '';
const base = (process.argv[2] || process.env.PUBLIC_BASE_URL || fromFile).replace(/\/+$/, '');
if (!base) throw new Error('PUBLIC_BASE_URL is empty: pass it as argv[2] or set it in .env');
if (!/^https:\/\//.test(base)) throw new Error('PUBLIC_BASE_URL must be https://...');
const cfgs = toolConfigs(base);
const list = await el<any>('GET', '/v1/convai/tools?page_size=100');
if (list.status !== 200) throw new Error(`list tools -> ${list.status} ${list.text.slice(0, 300)}`);
for (const name of TOOL_NAMES) {
  const t = (list.data.tools as any[]).find(x => x.tool_config?.name === name);
  if (!t) throw new Error(`tool ${name} not found; run scripts/create-agent.ts first`);
  const r = await el('PATCH', `/v1/convai/tools/${t.id}`, { tool_config: cfgs[name] });
  if (r.status !== 200) throw new Error(`patch ${name} -> ${r.status} ${r.text.slice(0, 400)}`);
  console.log(`${name} -> ${cfgs[name].api_schema.url}`);
}
console.log('done');
