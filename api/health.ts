export const config = { runtime: 'nodejs' };
export default function handler(_req: any, res: any) {
  res.status(200).json({ ok: true, service: 'larp-to-prospect', ts: new Date().toISOString() });
}
