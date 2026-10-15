import { waitUntil } from '@vercel/functions';
import { handleSubmit } from '../../agents/sandboxVendor.js';
export const config = { runtime: 'nodejs' };
export default async function handler(req: any, res: any) {
  await handleSubmit(req, res, { waitUntil, log: s => console.log('[vendor-sandbox]', s) });
}
