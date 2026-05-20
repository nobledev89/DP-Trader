import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../apps/api/server.js";
import { readConfig } from "../apps/api/config.js";
import { createStore } from "../apps/api/store.js";

test("state endpoint returns masked trading dashboard payload", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.url}/api/state`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.account);
    assert.ok(Array.isArray(body.signals));
    assert.equal(body.risk.liveTradingArmed, false);
  } finally {
    await server.close();
  }
});

test("settings endpoint stores integration keys without echoing secrets", async () => {
  const server = await startTestServer();
  try {
    const saveResponse = await fetch(`${server.url}/api/settings/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ integrations: { openai: { apiKey: "sk-test-secret" } } })
    });
    assert.equal(saveResponse.status, 200);
    const saveBody = await saveResponse.json();
    assert.equal(saveBody.integrations.openai.configured, true);
    assert.equal(JSON.stringify(saveBody).includes("sk-test-secret"), false);
  } finally {
    await server.close();
  }
});

async function startTestServer() {
  const cfg = readConfig({ PORT: "0", TRADING_MODE: "paper", ENABLE_LIVE_TRADING: "false" });
  const state = createStore();
  const server = http.createServer(createApp({ cfg, state }));
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
