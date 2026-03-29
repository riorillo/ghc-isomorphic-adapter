// GHC Auth Bridge – Service Worker
// Proxies all GitHub/Copilot API requests (bypasses CORS) and handles device flow.

const CLIENT_ID = "Iv1.b507a08c87ecfe98";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ghc-device-flow") {
    runDeviceFlow(sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg.type === "ghc-fetch") {
    proxyFetch(msg, sender.tab?.id).then(sendResponse);
    return true;
  }
});

// ── Generic fetch proxy ───────────────────────────────────────────

async function proxyFetch({ id, url, method, headers, body }, tabId) {
  let keepalive;
  try {
    keepalive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20_000);

    const res = await fetch(url, {
      method: method || "GET",
      headers: headers || {},
      body: body || undefined,
    });

    const resHeaders = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });

    // Send status + headers immediately so the page can construct the Response
    const send = (msg) =>
      tabId && chrome.tabs.sendMessage(tabId, msg).catch(() => {});

    send({ type: "ghc-fetch-head", id, status: res.status, headers: resHeaders });

    // Stream body chunks
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        send({ type: "ghc-fetch-chunk", id, chunk: decoder.decode(value, { stream: true }) });
      }
    }

    // Signal end of stream
    send({ type: "ghc-fetch-done", id });

    // sendResponse back to confirm completion
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e.message, id };
  } finally {
    clearInterval(keepalive);
  }
}

// ── Device flow ───────────────────────────────────────────────────

async function runDeviceFlow(tabId) {
  let keepalive;
  try {
    keepalive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20_000);

    const codeRes = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: "copilot" }),
    });
    if (!codeRes.ok) throw new Error(`device/code ${codeRes.status}`);
    const codes = await codeRes.json();

    broadcast({
      type: "ghc-device-codes",
      userCode: codes.user_code,
      verificationUri: codes.verification_uri,
    });

    const interval = (codes.interval || 5) * 1000;
    const deadline = Date.now() + codes.expires_in * 1000;

    while (Date.now() < deadline) {
      await sleep(interval);
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: codes.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      if (!tokenRes.ok) continue;
      const data = await tokenRes.json();
      if (data.access_token) return { ok: true, token: data.access_token };
      if (data.error === "expired_token") throw new Error("Code expired");
      if (data.error === "access_denied") throw new Error("User denied");
      if (data.error === "slow_down") await sleep(5000);
    }
    throw new Error("Timed out");
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearInterval(keepalive);
  }
}

function broadcast(msg) {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) if (t.id) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function broadcast(msg) {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) if (t.id) chrome.tabs.sendMessage(t.id, msg).catch(() => {});
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
