// GHC Auth Bridge – Content Script
// Relays messages between the web page and the extension service worker.

function isAlive() {
  return !!(chrome.runtime && chrome.runtime.id);
}

function postError(type, error, id) {
  window.postMessage({ type, ok: false, error, id }, "*");
}

// Page → Extension: device flow or fetch proxy
window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!d) return;

  if (d.type === "ghc-device-flow" || d.type === "ghc-fetch") {
    if (!isAlive()) {
      postError(
        d.type === "ghc-fetch" ? "ghc-fetch-result" : "ghc-auth-result",
        "Extension context invalidated. Reload the page.",
        d.id,
      );
      return;
    }
    try {
      chrome.runtime.sendMessage(d, (res) => {
        if (chrome.runtime.lastError) {
          postError(
            d.type === "ghc-fetch" ? "ghc-fetch-result" : "ghc-auth-result",
            chrome.runtime.lastError.message,
            d.id,
          );
          return;
        }
        const responseType = d.type === "ghc-fetch" ? "ghc-fetch-result" : "ghc-auth-result";
        window.postMessage({ type: responseType, ...res }, "*");
      });
    } catch {
      postError(
        d.type === "ghc-fetch" ? "ghc-fetch-result" : "ghc-auth-result",
        "Extension context invalidated. Reload the page.",
        d.id,
      );
    }
  }
});

// Extension → Page: intermediate messages (device codes, fetch head/chunks/done)
if (isAlive()) {
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (
        msg.type === "ghc-device-codes" ||
        msg.type === "ghc-fetch-head" ||
        msg.type === "ghc-fetch-chunk" ||
        msg.type === "ghc-fetch-done"
      ) {
        window.postMessage(msg, "*");
      }
    });
  } catch {}
}
