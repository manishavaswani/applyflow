/* ApplyFlow — content script entry point
   Detects the site adapter, injects the floating panel, and answers messages
   from the popup. Runs at document_idle on http/https pages.
   Load order in manifest: shared/schema → shared/templates → shared/match →
   content/adapters → content/autofill → content/panel → content/main. */
(function () {
  "use strict";
  if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;
  const schema = globalThis.ApplyFlowSchema;
  const match = globalThis.ApplyFlowMatch;
  const templates = globalThis.ApplyFlowTemplates;
  const adapters = globalThis.ApplyFlowAdapters;
  const autofill = globalThis.ApplyFlowAutofill;
  const panel = globalThis.ApplyFlowPanel;
  if (!schema || !match || !templates || !adapters || !autofill || !panel) return;

  const url = location.href;
  const adapter = adapters.detectAdapter(url);

  const state = {
    collapsed: false,
    adapterName: adapter.name,
    context: null,
    results: null,
    onFill: doFill,
    onEditProfile: () => chrome.runtime.sendMessage({ type: "applyflow:openOptions" })
  };

  function detectContext() {
    try {
      return adapter.detectContext(document, url) || {};
    } catch (e) {
      return {};
    }
  }

  async function getProfile() {
    const res = await chrome.storage.local.get(schema.STORAGE_KEY);
    return schema.normalizeProfile(res[schema.STORAGE_KEY]);
  }

  async function doFill() {
    const profile = await getProfile();
    state.context = detectContext();
    try {
      state.results = autofill.fillPage(document, profile, adapter, state.context, {});
    } catch (e) {
      state.results = { filled: [], manual: [{ key: "", label: "", reason: "Fill error: " + e.message }], skipped: 0 };
    }
    panel.render(document, state);
    return state.results;
  }

  // Inject panel only on pages that plausibly contain an application form.
  function looksLikeFormPage() {
    if (adapter.id !== "generic") return true;
    const fields = document.querySelectorAll("input, textarea, select");
    let plausible = 0;
    for (const el of fields) {
      if (match.matchField(autofill.getSignature(el, document))) plausible++;
      if (plausible >= 3) return true;
    }
    return false;
  }

  function init() {
    state.context = detectContext();
    if (looksLikeFormPage()) panel.render(document, state);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type === "applyflow:status") {
      sendResponse({
        adapter: { id: adapter.id, name: adapter.name },
        context: detectContext(),
        panelVisible: !!document.getElementById(panel.PANEL_ID)
      });
      return false;
    }
    if (msg.type === "applyflow:fill") {
      doFill().then((results) => sendResponse({ ok: true, results }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true; // async response
    }
    if (msg.type === "applyflow:context") {
      sendResponse({ context: detectContext(), adapter: { id: adapter.id, name: adapter.name } });
      return false;
    }
    return false;
  });
})();
