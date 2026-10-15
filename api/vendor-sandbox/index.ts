import { handleGet } from '../../agents/sandboxVendor.js';
export const config = { runtime: 'nodejs' };
export default function handler(req: any, res: any) {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).send('GET only'); return; }
  handleGet(req, res);
}
