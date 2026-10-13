/* ApplyFlow — content/auto-fill engine
   Pure DOM logic, no chrome.* APIs, so it can run under a Node DOM harness
   for tests. The browser entry point is content/main.js.
   Browser global: ApplyFlowAutofill. Node-requirable for tests.

   Design rule: ApplyFlow NEVER submits a form. There is deliberately no
   code path here that calls form.submit() or clicks submit buttons. */
(function (root, factory) {
  const deps = {
    match: typeof module !== "undefined" && module.exports
      ? require("../shared/match.js")
      : root.ApplyFlowMatch,
    templates: typeof module !== "undefined" && module.exports
      ? require("../shared/templates.js")
      : root.ApplyFlowTemplates
  };
  const api = factory(deps.match, deps.templates);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ApplyFlowAutofill = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (match, templates) {
  "use strict";

  const HIGHLIGHT_CLASS = "applyflow-filled";
  const BADGE_CLASS = "applyflow-manual-badge";
  const TEXT_TYPES = ["text", "email", "tel", "url", "number", "search", "date", "month", ""];

  /* ---------- field signature extraction ---------- */

  function textOf(el) {
    return (el && (el.textContent || "")).replace(/\s+/g, " ").trim();
  }

  // Find the best human-readable label for a field.
  function labelFor(el, doc) {
    if (!el) return "";
    const docRoot = doc || (el.ownerDocument || null);
    const id = el.getAttribute && el.getAttribute("id");
    if (id && docRoot && docRoot.querySelector) {
      try {
        const lbl = docRoot.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
        if (lbl && textOf(lbl)) return textOf(lbl);
      } catch (e) { /* malformed id — ignore */ }
    }
    // aria-labelledby
    const labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledBy && docRoot && docRoot.getElementById) {
      const parts = labelledBy.split(/\s+/).map((i) => {
        const node = docRoot.getElementById(i);
        return node ? textOf(node) : "";
      }).filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    // Wrapping <label>
    let p = el.parentElement;
    let hops = 0;
    while (p && hops < 4) {
      if (p.tagName && p.tagName.toLowerCase() === "label") {
        // Exclude the input's own text; take the label's full text.
        const t = textOf(p);
        if (t) return t;
      }
      // Preceding sibling label/div/span (common layout: <div><label>..</label><input></div>)
      if (!p.previousElementSibling && p.parentElement) {
        const grandPrev = p.parentElement.previousElementSibling;
        if (grandPrev && /^(label|div|span|p|legend)$/i.test(grandPrev.tagName || "")) {
          const t = textOf(grandPrev);
          if (t && t.length < 120) return t;
        }
      }
      const prev = p.previousElementSibling;
      if (prev && /^(label|div|span|p|legend)$/i.test(prev.tagName || "")) {
        const t = textOf(prev);
        if (t && t.length < 120) return t;
      }
      p = p.parentElement;
      hops++;
    }
    return "";
  }

  function getSignature(el, doc) {
    const g = (n) => (el.getAttribute && el.getAttribute(n)) || "";
    return {
      label: labelFor(el, doc),
      name: g("name"),
      id: g("id"),
      placeholder: g("placeholder"),
      autocomplete: g("autocomplete"),
      ariaLabel: g("aria-label"),
      tag: (el.tagName || "").toLowerCase(),
      type: (el.getAttribute && el.getAttribute("type") || "text").toLowerCase()
    };
  }

  function keyForElement(el, doc, adapter) {
    const hints = (adapter && adapter.selectorHints) || {};
    for (const [key, selectors] of Object.entries(hints)) {
      for (const sel of selectors) {
        try {
          if (el.matches && el.matches(sel)) return key;
        } catch (e) { /* bad selector — skip */ }
      }
    }
    return match.matchField(getSignature(el, doc));
  }

  /* ---------- visibility / fillability ---------- */

  function isVisible(el, doc) {
    if (!el) return false;
    if (el.disabled || el.getAttribute("aria-hidden") === "true") return false;
    if (el.getAttribute && el.getAttribute("type") === "hidden") return false;
    // jsdom/minimal harnesses have no layout; only trust explicit inline style
    // and the hidden attribute so tests aren't layout-dependent.
    const style = (el.getAttribute && el.getAttribute("style")) || "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return false;
    if (el.hasAttribute && el.hasAttribute("hidden")) return false;
    return true;
  }

  function isFillableText(el) {
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "select") return true;
    if (tag === "input") return TEXT_TYPES.includes((el.getAttribute("type") || "text").toLowerCase());
    return false;
  }

  /* ---------- value setting (framework-compatible) ---------- */

  function setNativeValue(el, value) {
    // React/Vue track the native setter; calling it directly keeps synthetic
    // event systems in sync.
    const proto = el.constructor && el.constructor.prototype;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fire(el, type) {
    try {
      const win = (el.ownerDocument && el.ownerDocument.defaultView) || null;
      const Ev = win && win.Event ? win.Event : Event;
      el.dispatchEvent(new Ev(type, { bubbles: true }));
    } catch (e) {
      try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e2) { /* harness without Event */ }
    }
  }

  function setTextValue(el, value) {
    if (el.readOnly) return false;
    try { el.focus && el.focus(); } catch (e) {}
    setNativeValue(el, value);
    fire(el, "input");
    fire(el, "change");
    try { el.blur && el.blur(); } catch (e) {}
    return true;
  }

  function setSelectValue(el, value) {
    const wanted = match.norm(value);
    if (!wanted) return false;
    let best = null;
    for (const opt of el.options || []) {
      const optText = match.norm(opt.textContent || "");
      const optVal = match.norm(opt.value || "");
      if (optText === wanted || optVal === wanted) { best = opt; break; }
      if (!best && (optText.includes(wanted) || wanted.includes(optText) && optText.length > 2)) best = opt;
    }
    if (!best) return false;
    el.value = best.value;
    fire(el, "input");
    fire(el, "change");
    return true;
  }

  /* ---------- radio / checkbox groups ---------- */

  function radioGroups(doc) {
    const groups = new Map();
    let anon = 0;
    const radios = doc.querySelectorAll('input[type="radio"]');
    for (const r of radios) {
      if (!isVisible(r, doc)) continue;
      let name = r.getAttribute("name");
      if (!name) name = "__anon_" + anon;
      anon++;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    }
    return groups;
  }

  function groupLabel(radio, doc) {
    // fieldset legend > wrapping label text > following text
    let p = radio.parentElement;
    while (p) {
      if ((p.tagName || "").toLowerCase() === "fieldset") {
        const legend = p.querySelector && p.querySelector("legend");
        if (legend && textOf(legend)) return textOf(legend);
      }
      p = p.parentElement;
    }
    return labelFor(radio, doc);
  }

  function optionLabel(radio, doc) {
    const id = radio.getAttribute && radio.getAttribute("id");
    if (id) {
      try {
        const lbl = doc.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]');
        if (lbl && textOf(lbl)) return textOf(lbl);
      } catch (e) {}
    }
    const p = radio.parentElement;
    if (p && (p.tagName || "").toLowerCase() === "label") return textOf(p);
    return (radio.getAttribute && (radio.getAttribute("value") || radio.getAttribute("aria-label"))) || "";
  }

  function setRadioGroup(radios, value, doc) {
    const wanted = match.norm(value);
    if (!wanted) return null;
    let best = null;
    for (const r of radios) {
      const lbl = match.norm(optionLabel(r, doc));
      if (!lbl) continue;
      if (lbl === wanted) { best = r; break; }
      if (!best && (lbl.includes(wanted) || wanted.includes(lbl))) best = r;
    }
    if (!best) return null;
    best.checked = true;
    fire(best, "change");
    fire(best, "click");
    return best;
  }

  /* ---------- file input injection ---------- */

  function base64ToBytes(base64) {
    const clean = (base64 || "").replace(/\s+/g, "");
    if (typeof atob === "function") {
      const bin = atob(clean);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    return new Uint8Array(Buffer.from(clean, "base64")); // Node harness
  }

  function buildFile(docEntry, fallbackName) {
    if (!docEntry || !docEntry.base64) return null;
    const bytes = base64ToBytes(docEntry.base64);
    const name = docEntry.fileName || fallbackName || "document.pdf";
    const type = docEntry.mimeType || "application/octet-stream";
    const FileCtor = (typeof File !== "undefined") ? File
      : (typeof globalThis !== "undefined" && globalThis.File) || null;
    if (!FileCtor) return null;
    return new FileCtor([bytes], name, { type });
  }

  // Attempt injection into <input type=file> via DataTransfer. Returns
  // "filled" | "manual" | "unsupported".
  function injectFile(input, file) {
    if (!file) return "manual";
    const DT = (typeof DataTransfer !== "undefined") ? DataTransfer
      : (typeof globalThis !== "undefined" && globalThis.DataTransfer) || null;
    if (!DT) return "unsupported";
    try {
      const dt = new DT();
      dt.items.add(file);
      input.files = dt.files;
      fire(input, "input");
      fire(input, "change");
      return input.files && input.files.length ? "filled" : "manual";
    } catch (e) {
      return "unsupported";
    }
  }

  /* ---------- highlighting / badges ---------- */

  function highlight(el, doc) {
    try {
      el.classList && el.classList.add(HIGHLIGHT_CLASS);
      // Inline style as a fallback so highlighting works even if the page
      // strips content-script stylesheets.
      if (el.style) {
        el.style.outline = "2px solid #a4543a";
        el.style.backgroundColor = "#f3e4dc";
      }
    } catch (e) {}
  }

  function addManualBadge(el, doc, docName) {
    try {
      const badge = doc.createElement("span");
      badge.className = BADGE_CLASS;
      badge.textContent = "Attach manually: " + docName;
      badge.setAttribute("style",
        "display:inline-block;margin-left:8px;padding:2px 8px;font:600 12px sans-serif;" +
        "color:#9a7b2d;background:#f4edd8;border:1px solid #ddd3ac;border-radius:3px;");
      el.insertAdjacentElement ? el.insertAdjacentElement("afterend", badge)
        : el.parentNode && el.parentNode.insertBefore(badge, el.nextSibling);
    } catch (e) {}
  }

  /* ---------- main entry ---------- */

  /* fillPage(doc, profile, adapter, context, opts)
     opts: { coverLetterId }
     returns { adapterId, context, filled: [{key,label,preview}], manual:
               [{key,label,reason}], skipped: number } */
  function fillPage(doc, profile, adapter, context, opts) {
    const ctx = context || {};
    const results = { adapterId: adapter ? adapter.id : "generic", context: ctx, filled: [], manual: [], skipped: 0 };
    if (!doc || !profile) return results;
    const handled = new Set();

    const recordFill = (el, key, value) => {
      const sig = getSignature(el, doc);
      highlight(el, doc);
      results.filled.push({
        key,
        label: sig.label || sig.name || sig.id || key,
        preview: value.length > 60 ? value.slice(0, 57) + "…" : value
      });
    };

    // --- text inputs / textareas / selects ---
    const fields = doc.querySelectorAll("input, textarea, select");
    for (const el of fields) {
      if (handled.has(el)) continue;
      const type = (el.getAttribute && (el.getAttribute("type") || "").toLowerCase()) || "";
      if (type === "file" || type === "radio" || type === "checkbox" || type === "hidden" ||
          type === "submit" || type === "button" || type === "password") continue;
      if (!isFillableText(el) || !isVisible(el, doc)) continue;
      const key = keyForElement(el, doc, adapter);
      if (!key) { results.skipped++; continue; }
      const value = match.valueForKey(profile, key, ctx, {
        templates, coverLetterId: opts && opts.coverLetterId
      });
      if (!value) { results.skipped++; continue; } // no data for this field
      const tag = (el.tagName || "").toLowerCase();
      const ok = tag === "select" ? setSelectValue(el, value) : setTextValue(el, value);
      handled.add(el);
      if (ok) recordFill(el, key, value);
      else {
        results.manual.push({ key, label: key, reason: "Could not set value (site may use a custom widget)" });
      }
    }

    // --- radio groups (EEO self-ID etc.) ---
    for (const [name, radios] of radioGroups(doc)) {
      const probe = radios[0];
      const sig = {
        label: groupLabel(probe, doc), name, id: probe.getAttribute("id") || "",
        placeholder: "", autocomplete: "", ariaLabel: probe.getAttribute("aria-label") || "",
        tag: "input", type: "radio"
      };
      const key = match.matchField(sig);
      if (!key) { results.skipped++; continue; }
      const value = match.valueForKey(profile, key, ctx, {});
      if (!value) { results.skipped++; continue; }
      const chosen = setRadioGroup(radios, value, doc);
      if (chosen) {
        highlight(chosen, doc);
        results.filled.push({ key, label: sig.label || name, preview: optionLabel(chosen, doc) || value });
      } else {
        results.manual.push({ key, label: sig.label || name, reason: "No matching option for: " + value });
      }
    }

    // --- file inputs (document upload slots) ---
    const fileInputs = doc.querySelectorAll('input[type="file"]');
    for (const input of fileInputs) {
      if (!isVisible(input, doc)) continue;
      let key = keyForElement(input, doc, adapter);
      if (!key) {
        // accept hints from the input's own attributes (accept=".pdf" etc.)
        key = match.matchField(getSignature(input, doc)) || "cv";
      }
      const docKind = match.FILE_DOC_KEYS[key];
      let file = null;
      let docName = "";
      if (docKind === "coverLetter") {
        const letters = profile.coverLetters || [];
        const chosen = letters.find((c) => c.id === (opts && opts.coverLetterId)) || letters[0];
        if (chosen) {
          docName = "Cover letter (" + (chosen.name || "Default") + ")";
          if (chosen.base64) {
            file = buildFile(chosen, "cover-letter.pdf");
          } else if (chosen.text) {
            const text = templates.substitutePlaceholders(chosen.text, Object.assign({
              firstName: profile.personal && profile.personal.firstName,
              lastName: profile.personal && profile.personal.lastName
            }, ctx));
            const FileCtor = typeof File !== "undefined" ? File : null;
            if (FileCtor) {
              try { file = new FileCtor([text], "cover-letter.txt", { type: "text/plain" }); } catch (e) {}
            }
          }
        }
      } else if (docKind) {
        const entry = profile.documents && profile.documents[docKind];
        if (entry && entry.base64) {
          docName = (entry.fileName || docKind);
          file = buildFile(entry, docKind + ".pdf");
        } else if (entry) {
          docName = docKind + " (not in profile)";
        }
      }
      if (!file) {
        if (docName) {
          addManualBadge(input, doc, docName);
          results.manual.push({ key: key, label: getSignature(input, doc).label || key, reason: "Attach manually: " + docName });
        } else {
          results.skipped++;
        }
        continue;
      }
      const status = injectFile(input, file);
      if (status === "filled") {
        highlight(input, doc);
        results.filled.push({ key: key, label: getSignature(input, doc).label || key, preview: "File: " + file.name });
      } else {
        addManualBadge(input, doc, file.name);
        results.manual.push({
          key, label: getSignature(input, doc).label || key,
          reason: "Attach manually: " + file.name + (status === "unsupported" ? " (this site blocks programmatic upload)" : "")
        });
      }
    }

    return results;
  }

  return {
    HIGHLIGHT_CLASS,
    BADGE_CLASS,
    labelFor,
    getSignature,
    keyForElement,
    isVisible,
    setTextValue,
    setSelectValue,
    setRadioGroup,
    base64ToBytes,
    buildFile,
    injectFile,
    highlight,
    addManualBadge,
    fillPage
  };
});
