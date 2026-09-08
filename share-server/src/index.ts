// index.ts — the Worker entry, and nothing else.
//
// Everything this service does lives in `handler.ts`, which is a pure function of (request,
// bindings, clock). This file is the only place that knows it is running on Cloudflare, which is
// exactly why it is three lines: there is no logic here to be untested.

import { handleRequest } from './handler'
import type { Env } from './env'

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env)
}
