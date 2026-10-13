/* ApplyFlow — toolbar popup logic */
(function () {
  "use strict";
  const schema = globalThis.ApplyFlowSchema;
  const templates = globalThis.ApplyFlowTemplates;
  const storage = globalThis.ApplyFlowStorage;

  const $ = (sel) => document.querySelector(sel);

  const state = {
    tab: null,
    adapter: null,
    context: {},
    profile: null,
    reachable: false
  };

  function status(msg, isError) {
    const el = $("#status-line");
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  function sendToTab(tabId, msg) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(resp || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function renderStatus() {
    const line = $("#adapter-line");
    if (!state.tab || !/^https?:/.test(state.tab.url || "")) {
      line.innerHTML = "Not an application page (extension can’t run here).";
      state.reachable = false;
    } else if (state.adapter) {
      line.innerHTML = "Detected adapter: <b>" + esc(state.adapter.name) + "</b>";
      state.reachable = true;
    } else {
      line.innerHTML = "No content script on this page — try reloading it.";
      state.reachable = false;
    }
    const ctx = state.context || {};
    const bits = [ctx.position, ctx.department, ctx.university].filter(Boolean);
    const ctxLine = $("#ctx-line");
    if (bits.length) {
      ctxLine.textContent = "Job context: " + bits.join(" · ");
      ctxLine.classList.remove("hidden");
    } else {
      ctxLine.classList.add("hidden");
    }
    $("#fill-btn").disabled = !state.reachable;
    $("#copy-letter-btn").disabled = !state.reachable;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderPickers() {
    const letterSel = $("#letter-select");
    letterSel.innerHTML = "";
    (state.profile.coverLetters || []).forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = (c.name || "Untitled") + (i === 0 ? " (default)" : "");
      letterSel.appendChild(opt);
    });
    const docSel = $("#doc-select");
    docSel.innerHTML = "";
    for (const kind of schema.DOC_KINDS) {
      const d = state.profile.documents[kind.id];
      const opt = document.createElement("option");
      opt.value = kind.id;
      opt.textContent = kind.label + (d && d.text ? "" : " (no text)");
      docSel.appendChild(opt);
    }
  }

  async function copyText(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      status(what + " copied to clipboard.");
    } catch (e) {
      status("Clipboard failed: " + e.message, true);
    }
  }

  async function boot() {
    state.profile = await storage.getProfile();
    state.tab = await activeTab();
    if (state.tab && state.tab.id != null) {
      const resp = await sendToTab(state.tab.id, { type: "applyflow:status" });
      if (resp) {
        state.adapter = resp.adapter;
        state.context = resp.context || {};
      }
    }
    renderStatus();
    renderPickers();

    $("#fill-btn").addEventListener("click", async () => {
      status("Filling…");
      const resp = await sendToTab(state.tab.id, { type: "applyflow:fill" });
      if (resp && resp.ok) {
        const r = resp.results;
        status("Filled " + r.filled.length + " field(s)" +
          (r.manual.length ? ", " + r.manual.length + " need manual attention" : "") +
          ". Review before submitting.");
      } else if (resp && !resp.ok) {
        status("Fill failed: " + resp.error, true);
      } else {
        status("Could not reach the page — reload it and try again.", true);
      }
    });

    $("#edit-profile-btn").addEventListener("click", () => {
      chrome.runtime.openOptionsPage
        ? chrome.runtime.openOptionsPage()
        : chrome.tabs.create({ url: chrome.runtime.getURL("profile/profile.html") });
      window.close();
    });

    $("#copy-letter-btn").addEventListener("click", async () => {
      // Refresh context just before copying so substitution is current.
      const resp = await sendToTab(state.tab.id, { type: "applyflow:context" });
      const ctx = (resp && resp.context) || state.context || {};
      const letters = state.profile.coverLetters || [];
      const letter = letters.find((c) => c.id === $("#letter-select").value) || letters[0];
      if (!letter || !letter.text) { status("Selected template has no text.", true); return; }
      const p = state.profile.personal;
      const text = templates.substitutePlaceholders(letter.text, Object.assign({
        firstName: p.firstName, lastName: p.lastName
      }, ctx));
      await copyText(text, "Cover letter");
    });

    $("#copy-doc-btn").addEventListener("click", async () => {
      const kind = $("#doc-select").value;
      const d = state.profile.documents[kind];
      if (!d || !d.text) { status("No stored text for that document.", true); return; }
      await copyText(d.text, "Document text");
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
