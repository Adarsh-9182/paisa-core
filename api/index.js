/**
 * Vercel entry point.
 *
 * The same handler the local server runs — see demo/app.js. Vercel's
 * req/res are node:http compatible, so nothing is adapted here.
 *
 * State note: each serverless instance seeds its own in-memory org at cold
 * start. The seed is deterministic, so every instance shows the same books,
 * but a mutation (approving a proposal, locking a period) lives only in the
 * instance that served it. Setting PAISA_DATABASE_URL and driving the app
 * through PaisaRuntime is what makes those durable — see spec 010.
 */

export { handle as default } from "../demo/app.js";
