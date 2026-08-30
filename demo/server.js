/**
 * Local entry point — runs the Paisa handler on a node:http server.
 * The handler itself lives in app.js so the Vercel function and this
 * server cannot drift apart.
 *
 * Run:  npm run build && node demo/server.js
 */

import { createServer } from "node:http";
import { handle } from "./app.js";

const PORT = process.env.PORT ?? 4000;

createServer(handle).listen(PORT, () => {
  console.log(`Paisa site        → http://localhost:${PORT}/site`);
  console.log(`Paisa AI CFO      → http://localhost:${PORT}/`);
  console.log(`Paisa ERP console → http://localhost:${PORT}/erp`);
  console.log(`Chat provider: ${process.env.ANTHROPIC_API_KEY ? "Anthropic with offline fallback" : "offline CfoPlanner"}`);
});
