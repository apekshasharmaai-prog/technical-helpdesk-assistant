import express from "express";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";

const root = fileURLToPath(new URL(".", import.meta.url));
const ticketSchema = z.object({
  ticket: z.string().trim().min(1).max(6000),
  customer_name: z.string().trim().max(100).optional(),
}).strict();
const processSchema = ticketSchema.extend({
  ticket_id: z.string().trim().min(1).max(80),
});
const resultSchema = z.object({
  ticket_id: z.string(), customer_name: z.string(), category: z.string(),
  priority: z.string(), language: z.string(), case_summary: z.string(),
  resolution_type: z.string(), recommended_action: z.string(),
  requires_human: z.boolean(), resolution_reason: z.string(), response: z.string(),
});
const samples = [
  {ticket_id:"TKT-4821", customer_name:"Sample customer A", ticket:"I was billed twice for my monthly plan. I see two charges for $24 on the same card. Could you check whether one can be refunded?"},
  {ticket_id:"TKT-4818", customer_name:"Sample customer B", ticket:"The project export keeps stopping at 82%. I have tried twice and the file never appears in my downloads."},
  {ticket_id:"TKT-4815", customer_name:"Sample customer C", ticket:"I can no longer sign in after changing phones. The verification code is going to my old number, which I cannot access."},
];

export function runWorkflow(ticket) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.env.PYTHON_BIN || "python3", ["runner.py"], {
      cwd: resolve(root, "python"), stdio: ["pipe", "pipe", "ignore"],
      env: {...process.env, PYTHONUNBUFFERED:"1"},
    });
    let output = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Workflow timed out"));
    }, 150_000);
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); }
      else resolveResult(result);
    }
    child.on("error", () => finish(new Error("Workflow unavailable")));
    child.stdin.on("error", () => finish(new Error("Workflow input failed")));
    child.stdout.on("data", chunk => {
      output += chunk.toString("utf8");
      if (output.length > 200_000) finish(new Error("Workflow output too large"));
    });
    child.on("close", code => {
      if (settled) return;
      try {
        if (code !== 0) throw new Error("Workflow failed");
        finish(null, JSON.parse(output));
      } catch { finish(new Error("Workflow returned an invalid result")); }
    });
    child.stdin.end(JSON.stringify(ticket));
  });
}

export function createApp({workflow = runWorkflow} = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Do not trust arbitrary forwarding headers for per-IP quotas.
  app.use(express.json({limit:"32kb"}));
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const usage = new Map();
  let active = 0;
  function admit(key, max) {
    const now = Date.now();
    for (const [id, value] of usage) if (value.until <= now) usage.delete(id);
    const value = usage.get(key) || {count:0, until:now + 3_600_000};
    if (value.count >= max) return false;
    value.count++;
    usage.set(key, value);
    return true;
  }
  app.get("/api/healthz", (_req, res) => res.json({status:"ok"}));
  app.get("/api/helpdesk/tickets", (_req, res) => res.json(samples));
  app.post("/api/helpdesk/tickets", (req, res) => {
    const parsed = ticketSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({error:"Enter a ticket message of 1–6000 characters and a name of at most 100 characters."});
    res.status(201).json({
      ...parsed.data, customer_name:parsed.data.customer_name || "Not provided",
      ticket_id:`TKT-${randomUUID().slice(0,8).toUpperCase()}`,
    });
  });
  app.post("/api/helpdesk/process", async (req, res) => {
    const parsed = processSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({error:"A valid ticket ID, customer name and message are required."});
    if (active >= 2 || !admit(req.ip || "visitor", 40) || !admit("global", 200)) {
      return res.set("Retry-After", "60").status(429).json({error:"The AI processing limit has been reached. Please wait and retry."});
    }
    active++;
    try {
      const ticket = {...parsed.data, customer_name:parsed.data.customer_name || "Not provided"};
      const result = resultSchema.parse(await workflow(ticket));
      if (result.ticket_id !== ticket.ticket_id) throw new Error("Mismatched ticket");
      res.json(result);
    } catch {
      res.status(503).json({error:"AI analysis could not be completed. Your ticket is still pending; please retry. If this continues, check the model configuration."});
    } finally { active--; }
  });
  app.use("/api", (_req, res) => res.status(404).json({error:"Unknown API route"}));
  app.use(express.static(resolve(root, "dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(root, "dist/index.html")));
  app.use((error, _req, res, _next) => {
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    res.status(status).json({error:status === 500 ? "The request could not be completed." : "Invalid or oversized request body."});
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  createApp().listen(port, "0.0.0.0", () => console.log(`Helpdesk listening on port ${port}`));
}
