export type Handler = (req: Request) => Response | Promise<Response>;

export type Middleware = (
	req: Request,
	next: Handler,
) => Response | Promise<Response>;

function chain(middlewares: Middleware[], handler: Handler): Handler {
	return middlewares.reduceRight<Handler>(
		(next, mw) => (req) => mw(req, next),
		handler,
	);
}

export default chain;
