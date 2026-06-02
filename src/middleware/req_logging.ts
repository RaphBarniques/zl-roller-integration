import { customLog } from '../logger';
import type { Handler, Middleware } from './middleware';

async function logging(req: Request, next: Handler): Promise<Response> {
	const start = Date.now();
	const ip = req.headers.get('X-Forwarded-For') ?? 'unknown';
	const ua = req.headers.get('User-Agent') ?? 'unknown';

	const res = await next(req);

	customLog(
		`${req.method} ${req.url} ${res.status} ${Date.now() - start}ms ip=${ip} ua=${ua}`,
	);
	return res;
}

export default logging;
