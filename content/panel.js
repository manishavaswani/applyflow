/* ApplyFlow — content/floating panel
   Shadow-DOM panel injected into application pages. Suite visual style
   (warm neutrals, serif headings, no gradients, no emoji). States the
   review-first rule in the UI: ApplyFlow never submits forms.
   Browser global: ApplyFlowPanel (loaded only in the content-script world). */
(function (root) {
  "use strict";

  const PANEL_ID = "applyflow-panel-host";

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel {
      position: fixed; top: 16px; right: 16px; z-index: 2147483646;
      width: 320px; max-height: 80vh; overflow-y: auto;
      background: #fffdf8; color: #35302a;
      border: 1px solid #e2d9c9; border-radius: 6px;
      box-shadow: 0 4px 18px rgba(53,48,42,0.18);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 13px; line-height: 1.45;
    }
    .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px 8px; border-bottom: 1px solid #e2d9c9;
    }
    .title {
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      font-size: 17px; font-weight: 600; color: #35302a;
    }
    .adapter { font-size: 11px; color: #6b6357; margin-top: 1px; }
    .close {
      appearance: none; border: 1px solid #e2d9c9; background: transparent;
      color: #6b6357; border-radius: 4px; width: 24px; height: 24px;
      cursor: pointer; font-size: 13px; line-height: 1;
    }
    .close:hover { background: #faf6ef; color: #35302a; }
    .body { padding: 10px 12px 12px; }
    .ctx { font-size: 12px; color: #6b6357; margin-bottom: 8px; }
    .ctx b { color: #35302a; font-weight: 600; }
    .btn {
      appearance: none; width: 100%; font-size: 13px; font-weight: 600;
      border-radius: 4px; border: 1px solid #a4543a; background: #a4543a;
      color: #fffdf8; padding: 7px 10px; cursor: pointer; margin-bottom: 6px;
    }
    .btn:hover { background: #84422e; border-color: #84422e; }
    .btn.ghost { background: #fffdf8; color: #84422e; }
    .btn.ghost:hover { background: #f3e4dc; }
    .btn[disabled] { opacity: 0.55; cursor: wait; }
    .rule {
      margin-top: 8px; padding: 7px 9px; font-size: 11.5px;
      background: #faf6ef; border-left: 3px solid #a4543a; color: #6b6357;
      border-radius: 3px;
    }
    .results { margin-top: 8px; }
    .results h4 {
      margin: 8px 0 4px; font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.05em; color: #6b6357;
    }
    .results ul { margin: 0; padding: 0; list-style: none; }
    .results li {
      padding: 4px 7px; margin-bottom: 3px; border-radius: 3px; font-size: 12px;
      overflow-wrap: break-word;
    }
    .results li.f { background: #e6ecdf; color: #5c7351; border: 1px solid #c9d6bd; }
    .results li.m { background: #f4edd8; color: #9a7b2d; border: 1px solid #ddd3ac; }
    .results li b { font-weight: 600; }
    .empty { color: #6b6357; font-size: 12px; }
    .tab {
      position: fixed; top: 16px; right: 0; z-index: 2147483646;
      writing-mode: vertical-rl; padding: 10px 5px;
      background: #a4543a; color: #fffdf8; border: none; border-radius: 4px 0 0 4px;
      font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      cursor: pointer;
    }
  `;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensure(doc) {
    let host = doc.getElementById(PANEL_ID);
    if (host) return host;
    host = doc.createElement("div");
    host.id = PANEL_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
    const wrap = doc.createElement("div");
    shadow.appendChild(wrap);
    (doc.body || doc.documentElement).appendChild(host);
    return host;
  }

  function render(doc, state) {
    const host = ensure(doc);
    const wrap = host.shadowRoot.lastElementChild;
    if (state.collapsed) {
      wrap.innerHTML = '<button class="tab" type="button">ApplyFlow</button>';
      wrap.querySelector(".tab").addEventListener("click", () => {
        state.collapsed = false;
        render(doc, state);
      });
      return;
    }
    const ctxBits = [];
    if (state.context && state.context.position) ctxBits.push("<b>" + esc(state.context.position) + "</b>");
    if (state.context && state.context.department) ctxBits.push(esc(state.context.department));
    if (state.context && state.context.university) ctxBits.push(esc(state.context.university));

    let resultsHtml = "";
    if (state.results) {
      const f = state.results.filled.map((r) =>
        '<li class="f"><b>' + esc(r.label) + "</b> — " + esc(r.preview) + "</li>").join("");
      const m = state.results.manual.map((r) =>
        '<li class="m">' + esc(r.reason || r.label) + "</li>").join("");
      resultsHtml =
        '<div class="results">' +
        "<h4>Filled " + state.results.filled.length + " field(s) · review highlighted boxes</h4>" +
        (f ? "<ul>" + f + "</ul>" : '<p class="empty">No fields were auto-filled.</p>') +
        (m ? "<h4>Needs manual attention</h4><ul>" + m + "</ul>" : "") +
        (state.results.skipped ? '<p class="empty">' + state.results.skipped + " unmatched field(s) left as-is.</p>" : "") +
        "</div>";
    }

    wrap.innerHTML =
      '<div class="panel">' +
      '<div class="head"><div><div class="title">ApplyFlow</div>' +
      '<div class="adapter">Detected: ' + esc(state.adapterName || "Generic (heuristic)") + "</div></div>" +
      '<button class="close" type="button" title="Minimize panel">–</button></div>' +
      '<div class="body">' +
      (ctxBits.length ? '<div class="ctx">Job context: ' + ctxBits.join(" · ") + "</div>" : "") +
      '<button class="btn" type="button" data-act="fill">Fill this page</button>' +
      '<button class="btn ghost" type="button" data-act="profile">Edit profile</button>' +
      '<div class="rule">Review-first: ApplyFlow fills fields and highlights them, ' +
      "but never submits forms and never sends your data anywhere. Check every highlighted field before you submit yourself.</div>" +
      resultsHtml +
      "</div></div>";

    wrap.querySelector(".close").addEventListener("click", () => {
      state.collapsed = true;
      render(doc, state);
    });
    wrap.querySelector('[data-act="fill"]').addEventListener("click", () => {
      if (state.onFill) state.onFill();
    });
    wrap.querySelector('[data-act="profile"]').addEventListener("click", () => {
      if (state.onEditProfile) state.onEditProfile();
    });
  }

  function remove(doc) {
    const host = doc.getElementById(PANEL_ID);
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  root.ApplyFlowPanel = { ensure, render, remove, PANEL_ID };
})(typeof globalThis !== "undefined" ? globalThis : this);
