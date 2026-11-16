// Netlify Function serving every /api/* route (streaming, Node runtime).
import { handle } from '../../server/handler';

export default async (req: Request, context: { ip?: string }) => handle(req, context?.ip || 'unknown');

export const config = { path: '/api/*' };
