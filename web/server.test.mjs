import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

const ticket = {ticket_id:"TEST-1", customer_name:"Fictional customer", ticket:"Export fails."};
const result = {
  ...ticket, category:"technical", priority:"medium", language:"English",
  case_summary:'{"issue":"Export fails"}', resolution_type:"human_review",
  recommended_action:"Investigate export", requires_human:true,
  resolution_reason:"Needs review", response:"We will review your export issue.",
};
async function withServer(options, run) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const post = (base, path, data) => fetch(`${base}/api/helpdesk/${path}`, {
  method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data),
});

test("serves the built standalone UI and pending samples", () => withServer({}, async base => {
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="root"><\/div>/);
  const samples = await fetch(`${base}/api/helpdesk/tickets`);
  assert.equal(samples.headers.get("cache-control"), "no-store");
  const data = await samples.json();
  assert.equal(data.length, 3);
  assert.ok(data.every(item => !item.result));
}));
test("ticket creation validates and normalizes input", () => withServer({}, async base => {
  assert.equal((await post(base, "tickets", {ticket:" "})).status, 400);
  assert.equal((await post(base, "tickets", {ticket:"x".repeat(6001)})).status, 400);
  assert.equal((await post(base, "tickets", {ticket:"message", customer_name:"x".repeat(101)})).status, 400);
  const response = await post(base, "tickets", {ticket:"  Export fails.  "});
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.match(created.ticket_id, /^TKT-/);
  assert.equal(created.ticket, "Export fails.");
  assert.equal(created.customer_name, "Not provided");
}));
test("real processing contract passes through structured workflow result", () =>
  withServer({workflow: async input => { assert.deepEqual(input, ticket); return result; }}, async base => {
    const response = await post(base, "process", ticket);
    assert.equal(response.status, 200);
    // The workflow output schema intentionally strips unknown fields.
    const {ticket: _unused, ...expected} = result;
    assert.deepEqual(await response.json(), expected);
    assert.equal((await post(base, "process", {...ticket, ticket_id:""})).status, 400);
  }));
test("workflow failures stay generic and preserve pending ticket behavior", () =>
  withServer({workflow: async () => { throw new Error("private provider payload"); }}, async base => {
    const response = await post(base, "process", ticket);
    assert.equal(response.status, 503);
    const message = (await response.json()).error;
    assert.match(message, /still pending/);
    assert.doesNotMatch(message, /private provider/);
  }));
test("rejects wrong-ticket responses", () =>
  withServer({workflow: async () => ({...result, ticket_id:"WRONG"})}, async base => {
    assert.equal((await post(base, "process", ticket)).status, 503);
  }));
test("limits concurrency and allows a later retry", () => {
  const releases = [];
  return withServer({workflow: () => new Promise(resolve => releases.push(() => resolve(result)))}, async base => {
    const first = post(base, "process", ticket);
    const second = post(base, "process", ticket);
    for (let i = 0; i < 100 && releases.length < 2; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(releases.length, 2);
    try {
      assert.equal((await post(base, "process", ticket)).status, 429);
    } finally { releases.forEach(release => release()); }
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
  });
});
