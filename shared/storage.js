/* ApplyFlow — shared/storage helpers
   Thin promise wrapper over chrome.storage.local. Everything the extension
   knows about you lives under one key ("applyflow.profile") in
   chrome.storage.local — nothing is ever transmitted anywhere.
   Browser-only (requires the chrome.storage API); not used in Node tests. */
(function (root, factory) {
  const schema = root.ApplyFlowSchema;
  const api = factory(schema);
  root.ApplyFlowStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (schema) {
  "use strict";

  function api() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      throw new Error("chrome.storage.local is not available in this context");
    }
    return chrome.storage.local;
  }

  async function getProfile() {
    const res = await api().get(schema.STORAGE_KEY);
    return schema.normalizeProfile(res[schema.STORAGE_KEY]);
  }

  async function saveProfile(profile) {
    const normalized = schema.normalizeProfile(profile);
    const check = schema.validateProfile(normalized);
    if (!check.ok) throw new Error("Invalid profile: " + check.errors.join("; "));
    await api().set({ [schema.STORAGE_KEY]: normalized });
    return normalized;
  }

  // Export: strip nothing — the whole profile, documents included, is yours.
  function exportProfileJson(profile) {
    return JSON.stringify(schema.normalizeProfile(profile), null, 2);
  }

  // Import: parse, validate, normalize. Throws on hard failure.
  function importProfileJson(jsonText) {
    let raw;
    try {
      raw = JSON.parse(jsonText);
    } catch (e) {
      throw new Error("Not valid JSON: " + e.message);
    }
    const check = schema.validateProfile(raw);
    if (!check.ok) throw new Error("Invalid profile file: " + check.errors.join("; "));
    return schema.normalizeProfile(raw);
  }

  // Rough byte-size of the stored profile (chrome.storage.local has a
  // ~5 MB default quota; documents are the big items).
  function profileSizeBytes(profile) {
    return exportProfileJson(profile).length;
  }

  async function clearProfile() {
    await api().remove(schema.STORAGE_KEY);
  }

  return { getProfile, saveProfile, exportProfileJson, importProfileJson, profileSizeBytes, clearProfile };
});
