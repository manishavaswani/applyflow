/* ApplyFlow — shared/profile schema
   Single source of truth for the profile shape stored in chrome.storage.local.
   Loaded as a classic script in extension pages/scripts (attaches to
   globalThis.ApplyFlowSchema) and requirable in Node for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ApplyFlowSchema = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PROFILE_VERSION = 1;
  const STORAGE_KEY = "applyflow.profile";

  // Fixed document kinds (single file each) stored in the document store.
  const DOC_KINDS = [
    { id: "cv", label: "CV / Resume" },
    { id: "research", label: "Research statement" },
    { id: "teaching", label: "Teaching statement" },
    { id: "diversity", label: "Diversity / equity statement" },
    { id: "personal", label: "Personal statement" },
    { id: "transcripts", label: "Transcripts" },
    { id: "other", label: "Other document" }
  ];

  function emptyDocument() {
    // A stored document: raw file as base64 plus extracted plain text.
    return {
      fileName: "",
      mimeType: "",
      base64: "", // raw file bytes, base64-encoded (no data: prefix)
      text: "", // extracted plain text (for copy/paste into textareas)
      updatedAt: 0
    };
  }

  function emptyEducation() {
    return { institution: "", degree: "", field: "", startYear: "", endYear: "" };
  }

  function emptyReference() {
    return { name: "", title: "", email: "", phone: "" };
  }

  function emptyCoverLetter() {
    // Cover letters are named templates with {{position}} / {{department}} /
    // {{university}} placeholders; optionally a stored file too.
    return {
      id: "",
      name: "Default",
      text: "",
      fileName: "",
      mimeType: "",
      base64: "",
      updatedAt: 0
    };
  }

  function emptyProfile() {
    const docs = {};
    for (const k of DOC_KINDS) docs[k.id] = emptyDocument();
    return {
      version: PROFILE_VERSION,
      personal: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        address1: "",
        address2: "",
        city: "",
        state: "",
        zip: "",
        country: "",
        homepage: "",
        scholar: "",
        orcid: "",
        linkedin: ""
      },
      education: [], // array of emptyEducation(), index 0 = most recent
      position: { title: "", department: "", institution: "", startDate: "" },
      references: [], // array of emptyReference()
      eeo: {
        // Voluntary self-identification answers common in US academic HR
        // portals. Everything here is optional and stays on-device.
        gender: "",
        race: "",
        hispanic: "",
        veteran: "",
        disability: ""
      },
      application: {
        // Reusable answers for common free-text application questions.
        referral: "", // "How did you hear about this position?"
        salary: "",
        startDate: "",
        workAuthorization: ""
      },
      documents: docs,
      coverLetters: [Object.assign(emptyCoverLetter(), { id: "default", name: "Default" })]
    };
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  // Deep-merge `raw` onto a fresh empty profile, coercing wrong types to
  // defaults. Unknown keys are dropped so imported files can't smuggle
  // unexpected structure in.
  function normalizeProfile(raw) {
    const base = emptyProfile();
    if (!isPlainObject(raw)) return base;

    function mergeSection(target, src, template) {
      if (!isPlainObject(src)) return;
      for (const k of Object.keys(template)) {
        if (typeof src[k] === "string") target[k] = src[k];
      }
    }

    if (typeof raw.version === "number") base.version = raw.version;
    mergeSection(base.personal, raw.personal, emptyProfile().personal);
    mergeSection(base.position, raw.position, emptyProfile().position);
    mergeSection(base.eeo, raw.eeo, emptyProfile().eeo);
    mergeSection(base.application, raw.application, emptyProfile().application);

    if (Array.isArray(raw.education)) {
      base.education = raw.education
        .filter(isPlainObject)
        .map((e) => {
          const row = emptyEducation();
          mergeSection(row, e, emptyEducation());
          return row;
        });
    }
    if (Array.isArray(raw.references)) {
      base.references = raw.references
        .filter(isPlainObject)
        .map((r) => {
          const row = emptyReference();
          mergeSection(row, r, emptyReference());
          return row;
        });
    }
    if (Array.isArray(raw.coverLetters)) {
      const cls = raw.coverLetters.filter(isPlainObject).map((c) => {
        const row = emptyCoverLetter();
        mergeSection(row, c, emptyCoverLetter());
        if (typeof c.updatedAt === "number") row.updatedAt = c.updatedAt;
        if (!row.id) row.id = "cl-" + Math.random().toString(36).slice(2, 10);
        return row;
      });
      if (cls.length) base.coverLetters = cls;
    }
    if (isPlainObject(raw.documents)) {
      for (const k of DOC_KINDS.map((d) => d.id)) {
        const src = raw.documents[k];
        if (!isPlainObject(src)) continue;
        const row = emptyDocument();
        mergeSection(row, src, emptyDocument());
        if (typeof src.updatedAt === "number") row.updatedAt = src.updatedAt;
        base.documents[k] = row;
      }
    }
    return base;
  }

  // Structural validation. Returns { ok, errors: [string] }.
  // Validation is structural (types/shape), not completeness — an empty
  // profile is valid.
  function validateProfile(raw) {
    const errors = [];
    if (!isPlainObject(raw)) {
      return { ok: false, errors: ["profile is not an object"] };
    }
    if (raw.version !== undefined && typeof raw.version !== "number") {
      errors.push("version must be a number");
    }
    const strSections = { personal: emptyProfile().personal, position: emptyProfile().position, eeo: emptyProfile().eeo, application: emptyProfile().application };
    for (const [sec, tmpl] of Object.entries(strSections)) {
      if (raw[sec] === undefined) continue;
      if (!isPlainObject(raw[sec])) {
        errors.push(sec + " must be an object");
        continue;
      }
      for (const k of Object.keys(raw[sec])) {
        if (!(k in tmpl)) errors.push(sec + "." + k + " is not a known field");
        else if (typeof raw[sec][k] !== "string") errors.push(sec + "." + k + " must be a string");
      }
    }
    const arrayChecks = [
      ["education", emptyEducation()],
      ["references", emptyReference()]
    ];
    for (const [key, tmpl] of arrayChecks) {
      if (raw[key] === undefined) continue;
      if (!Array.isArray(raw[key])) {
        errors.push(key + " must be an array");
        continue;
      }
      raw[key].forEach((row, i) => {
        if (!isPlainObject(row)) {
          errors.push(key + "[" + i + "] must be an object");
          return;
        }
        for (const k of Object.keys(row)) {
          if (!(k in tmpl)) errors.push(key + "[" + i + "]." + k + " is not a known field");
          else if (typeof row[k] !== "string") errors.push(key + "[" + i + "]." + k + " must be a string");
        }
      });
    }
    if (raw.coverLetters !== undefined) {
      if (!Array.isArray(raw.coverLetters)) errors.push("coverLetters must be an array");
      else {
        raw.coverLetters.forEach((c, i) => {
          if (!isPlainObject(c)) errors.push("coverLetters[" + i + "] must be an object");
          else if (c.text !== undefined && typeof c.text !== "string")
            errors.push("coverLetters[" + i + "].text must be a string");
        });
      }
    }
    if (raw.documents !== undefined) {
      if (!isPlainObject(raw.documents)) errors.push("documents must be an object");
      else {
        for (const k of Object.keys(raw.documents)) {
          if (!DOC_KINDS.some((d) => d.id === k)) {
            errors.push("documents." + k + " is not a known document kind");
            continue;
          }
          const doc = raw.documents[k];
          if (!isPlainObject(doc)) {
            errors.push("documents." + k + " must be an object");
            continue;
          }
          if (doc.base64 !== undefined && typeof doc.base64 !== "string")
            errors.push("documents." + k + ".base64 must be a string");
          if (doc.base64 && !/^[A-Za-z0-9+/=\s]*$/.test(doc.base64))
            errors.push("documents." + k + ".base64 is not valid base64");
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  return {
    PROFILE_VERSION,
    STORAGE_KEY,
    DOC_KINDS,
    emptyDocument,
    emptyEducation,
    emptyReference,
    emptyCoverLetter,
    emptyProfile,
    normalizeProfile,
    validateProfile
  };
});
