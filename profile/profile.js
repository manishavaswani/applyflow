/* ApplyFlow — profile manager page logic
   All state lives in `state.profile`, auto-saved (debounced) to
   chrome.storage.local via shared/storage.js. No network access anywhere. */
(function () {
  "use strict";
  const schema = globalThis.ApplyFlowSchema;
  const templates = globalThis.ApplyFlowTemplates;
  const storage = globalThis.ApplyFlowStorage;

  const state = {
    profile: schema.emptyProfile(),
    saveTimer: null,
    activeLetterId: null
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- persistence ---------- */

  function setPath(obj, path, value) {
    const parts = path.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
  }

  function getPath(obj, path) {
    return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  }

  function markSaved(msg, isError) {
    const el = $("#save-status");
    el.textContent = msg || "All changes saved — stored locally in this browser.";
    el.classList.toggle("error", !!isError);
  }

  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 400);
  }

  async function saveNow() {
    try {
      state.profile = await storage.saveProfile(state.profile);
      markSaved();
      updateStorageUsage();
    } catch (e) {
      markSaved("Save failed: " + e.message, true);
    }
  }

  function updateStorageUsage() {
    const bytes = storage.profileSizeBytes(state.profile);
    const mb = bytes / (1024 * 1024);
    const el = $("#storage-usage");
    if (el) {
      el.textContent = "Local storage used by this profile: " +
        (mb > 0.1 ? mb.toFixed(2) + " MB" : Math.round(bytes / 1024) + " KB") +
        " (chrome.storage.local quota is ~5 MB; documents are the large items).";
    }
  }

  /* ---------- tabs ---------- */

  function initTabs() {
    $$(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
        $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
      });
    });
  }

  /* ---------- simple bound inputs ---------- */

  function initBoundInputs() {
    $$("[data-bind]").forEach((input) => {
      const path = input.dataset.bind;
      const v = getPath(state.profile, path);
      if (typeof v === "string") input.value = v;
      input.addEventListener("input", () => {
        setPath(state.profile, path, input.value);
        scheduleSave();
      });
    });
  }

  /* ---------- repeating sections (education, references) ---------- */

  function renderEducation() {
    const list = $("#education-list");
    list.innerHTML = "";
    if (!state.profile.education.length) {
      list.innerHTML = '<p class="hint">No education entries yet.</p>';
    }
    state.profile.education.forEach((edu, i) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-head"><h4>Education ' + (i + 1) + (i === 0 ? " (most recent)" : "") + "</h4>" +
        '<button class="btn small danger" type="button">Remove</button></div>' +
        '<div class="form-grid">' +
        fieldHtml("Institution", "institution", edu.institution, 12) +
        fieldHtml("Degree", "degree", edu.degree, 6) +
        fieldHtml("Field of study", "field", edu.field, 6) +
        fieldHtml("Start year", "startYear", edu.startYear, 3) +
        fieldHtml("End / graduation year", "endYear", edu.endYear, 3) +
        "</div>";
      card.querySelector("button").addEventListener("click", () => {
        state.profile.education.splice(i, 1);
        renderEducation();
        scheduleSave();
      });
      $$("input", card).forEach((input) => {
        input.addEventListener("input", () => {
          state.profile.education[i][input.dataset.k] = input.value;
          scheduleSave();
        });
      });
      list.appendChild(card);
    });
  }

  function fieldHtml(label, key, value, span) {
    return '<div class="field"' + (span === 12 ? ' style="grid-column:1/-1"' : "") + ">" +
      '<label class="field-label">' + esc(label) + "</label>" +
      '<input type="text" data-k="' + esc(key) + '" value="' + esc(value) + '"></div>';
  }

  function renderReferences() {
    const list = $("#reference-list");
    list.innerHTML = "";
    if (!state.profile.references.length) {
      list.innerHTML = '<p class="hint">No references yet.</p>';
    }
    state.profile.references.forEach((ref, i) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-head"><h4>Reference ' + (i + 1) + "</h4>" +
        '<button class="btn small danger" type="button">Remove</button></div>' +
        '<div class="form-grid">' +
        fieldHtml("Name", "name", ref.name, 6) +
        fieldHtml("Title / institution", "title", ref.title, 6) +
        fieldHtml("Email", "email", ref.email, 6) +
        fieldHtml("Phone", "phone", ref.phone, 6) +
        "</div>";
      card.querySelector("button").addEventListener("click", () => {
        state.profile.references.splice(i, 1);
        renderReferences();
        scheduleSave();
      });
      $$("input", card).forEach((input) => {
        input.addEventListener("input", () => {
          state.profile.references[i][input.dataset.k] = input.value;
          scheduleSave();
        });
      });
      list.appendChild(card);
    });
  }

  /* ---------- file reading & text extraction ---------- */

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const buf = new Uint8Array(reader.result);
        let bin = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < buf.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
        }
        resolve(btoa(bin));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  // Best-effort PDF text extraction: pulls literal strings from text-showing
  // operators (Tj / TJ). Works for simple PDFs; compressed object streams may
  // yield nothing — the user can paste text manually instead.
  function extractPdfText(bytes) {
    let raw = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      raw += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    const out = [];
    const re = /\(((?:\\.|[^\\()])*)\)\s*Tj|\[((?:\((?:\\.|[^\\()])*\)|[^\]])*)\]\s*TJ/g;
    let m;
    const unesc = (s) => s.replace(/\\([\\()])/g, "$1")
      .replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ")
      .replace(/\\(\d{1,3})/g, (x, n) => String.fromCharCode(parseInt(n, 8)));
    while ((m = re.exec(raw))) {
      if (m[1] !== undefined) out.push(unesc(m[1]));
      else {
        const parts = [];
        const inner = /\(((?:\\.|[^\\()])*)\)/g;
        let p;
        while ((p = inner.exec(m[2]))) parts.push(unesc(p[1]));
        out.push(parts.join(""));
      }
    }
    return out.join(" ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, 200000);
  }

  async function extractText(file) {
    if (/\.(txt|md|text)$/i.test(file.name) || /^text\//.test(file.type)) {
      return await readFileAsText(file);
    }
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const base64 = await readFileAsBase64(file);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      return extractPdfText(bytes);
    }
    return ""; // docx etc. — user can paste text manually
  }

  function fmtBytes(n) {
    return n > 1024 * 1024 ? (n / (1024 * 1024)).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
  }

  /* ---------- document store ---------- */

  function renderDocuments() {
    const list = $("#document-list");
    list.innerHTML = "";
    for (const kind of schema.DOC_KINDS) {
      const docEntry = state.profile.documents[kind.id];
      const has = !!docEntry.base64;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML =
        '<div class="card-head"><h4>' + esc(kind.label) + "</h4>" +
        '<span class="badge ' + (has ? "ok" : "none") + '">' + (has ? "Stored" : "Empty") + "</span></div>" +
        '<div class="card-meta">' +
        (has
          ? esc(docEntry.fileName) + " · " + fmtBytes(Math.round(docEntry.base64.length * 3 / 4)) +
            " · updated " + new Date(docEntry.updatedAt).toLocaleDateString()
          : "No file stored.") +
        "</div>" +
        '<div class="button-row">' +
        '<label class="btn small" for="doc-file-' + kind.id + '">' + (has ? "Replace file" : "Upload file") + "</label>" +
        '<input type="file" id="doc-file-' + kind.id + '" class="hidden" accept=".pdf,.doc,.docx,.txt,.md">' +
        (has ? '<button class="btn small danger" type="button" data-act="remove">Remove</button>' : "") +
        '<button class="btn small ghost" type="button" data-act="copytext"' + (docEntry.text ? "" : " disabled") + ">Copy text</button>" +
        "</div>" +
        '<label class="field-label" for="doc-text-' + kind.id + '">Extracted text (editable — pasted into statement textareas)</label>' +
        '<textarea id="doc-text-' + kind.id + '" rows="5" placeholder="(auto-extracted on upload; you can paste or edit text here)">' +
        esc(docEntry.text) + "</textarea>";
      const fileInput = $("input[type=file]", card);
      fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
          const base64 = await readFileAsBase64(file);
          const text = await extractText(file);
          state.profile.documents[kind.id] = {
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            base64,
            text,
            updatedAt: Date.now()
          };
          await saveNow();
          renderDocuments();
        } catch (e) {
          markSaved("Upload failed: " + e.message, true);
        }
      });
      const removeBtn = $('[data-act="remove"]', card);
      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          state.profile.documents[kind.id] = schema.emptyDocument();
          renderDocuments();
          scheduleSave();
        });
      }
      $('[data-act="copytext"]', card).addEventListener("click", async (ev) => {
        try {
          await navigator.clipboard.writeText(state.profile.documents[kind.id].text || "");
          ev.target.textContent = "Copied";
          setTimeout(renderDocuments, 800);
        } catch (e) {
          markSaved("Clipboard copy failed: " + e.message, true);
        }
      });
      const ta = $("textarea", card);
      ta.addEventListener("input", () => {
        state.profile.documents[kind.id].text = ta.value;
        scheduleSave();
      });
      list.appendChild(card);
    }
  }

  /* ---------- cover letter templates ---------- */

  function activeLetter() {
    const letters = state.profile.coverLetters;
    return letters.find((c) => c.id === state.activeLetterId) || letters[0];
  }

  function renderLetterPicker() {
    const picker = $("#letter-picker");
    picker.innerHTML = "";
    state.profile.coverLetters.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = (c.name || "Untitled") + (i === 0 ? " (default)" : "");
      picker.appendChild(opt);
    });
    picker.value = activeLetter().id;
  }

  function renderPlaceholderChips() {
    const row = $("#ph-row");
    row.innerHTML = "";
    for (const name of templates.KNOWN) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ph-chip";
      chip.textContent = "{{" + name + "}}";
      chip.title = "Insert at cursor";
      chip.addEventListener("click", () => {
        const ta = $("#letter-text");
        const ins = "{{" + name + "}}";
        const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
        ta.value = ta.value.slice(0, start) + ins + ta.value.slice(ta.selectionEnd || start);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + ins.length;
        activeLetter().text = ta.value;
        warnUnknownPlaceholders();
        scheduleSave();
      });
      row.appendChild(chip);
    }
  }

  function warnUnknownPlaceholders() {
    const unknown = templates.unknownPlaceholders($("#letter-text").value);
    $("#ph-warning").textContent = unknown.length
      ? "Warning: unrecognized placeholder(s) " + unknown.map((u) => "{{" + u + "}}").join(", ") +
        " — they will be left as-is when filling. Known: " + templates.KNOWN.map((k) => "{{" + k + "}}").join(", ") + "."
      : "";
  }

  function renderLetterEditor() {
    const letter = activeLetter();
    state.activeLetterId = letter.id;
    $("#letter-text").value = letter.text;
    $("#letter-file").value = "";
    const removeBtn = $("#remove-letter-file");
    removeBtn.textContent = letter.base64
      ? "Remove attached file (" + letter.fileName + ")"
      : "Remove attached file";
    warnUnknownPlaceholders();
    $("#letter-preview").classList.add("hidden");
  }

  function initLetters() {
    renderPlaceholderChips();
    $("#letter-picker").addEventListener("change", (e) => {
      state.activeLetterId = e.target.value;
      renderLetterEditor();
    });
    $("#letter-text").addEventListener("input", (e) => {
      activeLetter().text = e.target.value;
      activeLetter().updatedAt = Date.now();
      warnUnknownPlaceholders();
      scheduleSave();
    });
    $("#add-letter").addEventListener("click", () => {
      const c = schema.emptyCoverLetter();
      c.id = "cl-" + Date.now().toString(36);
      c.name = "Template " + (state.profile.coverLetters.length + 1);
      state.profile.coverLetters.push(c);
      state.activeLetterId = c.id;
      renderLetterPicker();
      renderLetterEditor();
      scheduleSave();
    });
    $("#rename-letter").addEventListener("click", () => {
      const letter = activeLetter();
      const name = prompt("Template name:", letter.name || "");
      if (name === null) return;
      letter.name = name.trim() || letter.name;
      renderLetterPicker();
      scheduleSave();
    });
    $("#delete-letter").addEventListener("click", () => {
      if (state.profile.coverLetters.length <= 1) {
        alert("Keep at least one template. Clear its text instead if you do not need it.");
        return;
      }
      const letter = activeLetter();
      if (!confirm('Delete template "' + (letter.name || "Untitled") + '"?')) return;
      state.profile.coverLetters = state.profile.coverLetters.filter((c) => c.id !== letter.id);
      state.activeLetterId = state.profile.coverLetters[0].id;
      renderLetterPicker();
      renderLetterEditor();
      scheduleSave();
    });
    $("#letter-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const base64 = await readFileAsBase64(file);
        const letter = activeLetter();
        letter.fileName = file.name;
        letter.mimeType = file.type || "application/octet-stream";
        letter.base64 = base64;
        letter.updatedAt = Date.now();
        renderLetterEditor();
        scheduleSave();
      } catch (err) {
        markSaved("Upload failed: " + err.message, true);
      }
    });
    $("#remove-letter-file").addEventListener("click", () => {
      const letter = activeLetter();
      letter.fileName = "";
      letter.mimeType = "";
      letter.base64 = "";
      renderLetterEditor();
      scheduleSave();
    });
    $("#preview-letter").addEventListener("click", () => {
      const sample = {
        position: "Assistant Professor of Sociology",
        department: "Department of Sociology",
        university: "Example University"
      };
      const p = state.profile.personal;
      const box = $("#letter-preview");
      box.textContent = templates.substitutePlaceholders(activeLetter().text, Object.assign({
        firstName: p.firstName, lastName: p.lastName
      }, sample));
      box.classList.remove("hidden");
    });
  }

  /* ---------- export / import ---------- */

  function initBackup() {
    $("#export-btn").addEventListener("click", () => {
      const json = storage.exportProfileJson(state.profile);
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "applyflow-profile-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    $("#import-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      const errBox = $("#import-error");
      const okBox = $("#import-ok");
      errBox.classList.add("hidden");
      okBox.classList.add("hidden");
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        state.profile = storage.importProfileJson(text);
        await saveNow();
        renderAll();
        okBox.textContent = "Profile imported successfully.";
        okBox.classList.remove("hidden");
      } catch (err) {
        errBox.textContent = "Import failed: " + err.message;
        errBox.classList.remove("hidden");
      } finally {
        e.target.value = "";
      }
    });
    $("#clear-btn").addEventListener("click", async () => {
      if (!confirm("Erase the entire ApplyFlow profile, including all documents? This cannot be undone.")) return;
      await storage.clearProfile();
      state.profile = schema.emptyProfile();
      renderAll();
      markSaved("All data erased.");
      updateStorageUsage();
    });
  }

  /* ---------- boot ---------- */

  function renderAll() {
    initBoundInputsValues();
    renderEducation();
    renderReferences();
    renderDocuments();
    renderLetterPicker();
    renderLetterEditor();
    updateStorageUsage();
  }

  function initBoundInputsValues() {
    $$("[data-bind]").forEach((input) => {
      const v = getPath(state.profile, input.dataset.bind);
      if (typeof v === "string") input.value = v;
    });
  }

  async function boot() {
    initTabs();
    try {
      state.profile = await storage.getProfile();
    } catch (e) {
      markSaved("Could not load stored profile: " + e.message, true);
    }
    state.activeLetterId = (state.profile.coverLetters[0] || {}).id || null;
    initBoundInputs();
    renderAll();
    $("#add-education").addEventListener("click", () => {
      state.profile.education.unshift(schema.emptyEducation());
      renderEducation();
      scheduleSave();
    });
    $("#add-reference").addEventListener("click", () => {
      state.profile.references.push(schema.emptyReference());
      renderReferences();
      scheduleSave();
    });
    initLetters();
    initBackup();
    markSaved();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
