/* ApplyFlow — content/site adapters
   Each adapter knows how to (a) recognize its site, (b) supply extra
   selector hints for known fields before the generic matcher runs, and
   (c) detect job context (position / department / university) from the page
   for cover-letter placeholder substitution.
   Site portals change often; adapters are best-effort and layered ON TOP of
   the generic heuristic matcher, so a stale selector degrades gracefully to
   generic matching instead of breaking.
   Browser global: ApplyFlowAdapters. Node-requirable for tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ApplyFlowAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function txt(doc, sel) {
    const el = doc.querySelector(sel);
    return el ? (el.textContent || "").trim() : "";
  }
  function attr(doc, sel, name) {
    const el = doc.querySelector(sel);
    return el ? (el.getAttribute(name) || "").trim() : "";
  }
  function metaContent(doc, name) {
    return attr(doc, 'meta[name="' + name + '"]', "content") ||
           attr(doc, 'meta[property="' + name + '"]', "content");
  }
  function hostnameOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ""; }
  }
  function titleCase(s) {
    return String(s || "").replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }

  const adapters = [
    {
      id: "workday",
      name: "Workday",
      match: (url) => /\.myworkdayjobs\.com$|\.wd\d+\.myworkdayjobs\.com$/.test(hostnameOf(url)),
      // Workday renders with data-automation-id attributes.
      selectorHints: {
        firstName: ['input[data-automation-id="legalNameSection_firstName"]'],
        lastName: ['input[data-automation-id="legalNameSection_lastName"]'],
        email: ['input[data-automation-id="email"]', 'input[data-automation-id="userName"]'],
        phone: ['input[data-automation-id="phone-number"]', 'input[data-automation-id="phoneNumber"]'],
        address1: ['input[data-automation-id="addressSection_addressLine1"]'],
        city: ['input[data-automation-id="addressSection_city"]'],
        zip: ['input[data-automation-id="addressSection_postalCode"]'],
        country: ['button[data-automation-id="addressSection_countryRegion"]']
      },
      fileInputHint: 'input[type="file"][data-automation-id*="file"]',
      detectContext(doc, url) {
        const position =
          txt(doc, '[data-automation-id="jobPostingHeader"]') ||
          txt(doc, "h1") ||
          metaContent(doc, "og:title").replace(/\s*[-|].*$/, "");
        const host = hostnameOf(url);
        const tenant = titleCase((host.split(".")[0] || "").replace(/wd\d+$/, ""));
        return { position, department: "", university: tenant };
      }
    },
    {
      id: "interfolio",
      name: "Interfolio",
      match: (url) => hostnameOf(url) === "apply.interfolio.com",
      selectorHints: {},
      detectContext(doc) {
        // Position pages carry an h1 with the title; meta description often
        // has "University - Department".
        const position = txt(doc, "h1") || metaContent(doc, "og:title");
        let university = "", department = "";
        const meta = metaContent(doc, "description") || metaContent(doc, "og:description");
        const m = meta.match(/^\s*([^-–|]{3,80}?)\s*[-–|]\s*([^-–|]{3,80}?)(?:\s*[-–|]|$)/);
        if (m) { university = m[1].trim(); department = m[2].trim(); }
        return { position, department, university };
      }
    },
    {
      id: "academicjobsonline",
      name: "Academic Jobs Online",
      match: (url) => /(^|\.)academicjobsonline\.org$/.test(hostnameOf(url)),
      selectorHints: {
        email: ['input[name="email"]'],
        firstName: ['input[name="firstname"]', 'input[name="first_name"]'],
        lastName: ['input[name="lastname"]', 'input[name="last_name"]']
      },
      detectContext(doc) {
        const position = txt(doc, "h1") || txt(doc, "h2") || metaContent(doc, "og:title");
        // AJO pages typically read "University Name, Department" near the top.
        let university = "", department = "";
        const body = (doc.body && doc.body.textContent || "").slice(0, 3000);
        const m = body.match(/([A-Z][\w&' .-]{2,60}(?:University|College|Institute|School)[\w&' .-]*)\s*,\s*([A-Z][\w&' .-]{2,60})/);
        if (m) { university = m[1].trim(); department = m[2].trim(); }
        return { position, department, university };
      }
    },
    {
      id: "linkedin",
      name: "LinkedIn Easy Apply",
      match: (url) => /(^|\.)linkedin\.com$/.test(hostnameOf(url)),
      selectorHints: {
        phone: ['input[id*="phoneNumber"]'],
        email: ['input[id*="email"]']
      },
      detectContext(doc) {
        const position =
          txt(doc, ".job-details-jobs-unified-top-card__job-title") ||
          txt(doc, ".jobs-unified-top-card__job-title") ||
          txt(doc, "h1");
        const university =
          txt(doc, ".job-details-jobs-unified-top-card__company-name") ||
          txt(doc, ".jobs-unified-top-card__company-name");
        return { position, department: "", university };
      }
    },
    {
      id: "indeed",
      name: "Indeed",
      match: (url) => /(^|\.)indeed\.com$|(^|\.)smartapply\.indeed\.com$/.test(hostnameOf(url)),
      selectorHints: {},
      detectContext(doc) {
        const position =
          txt(doc, '[data-testid="jobsearch-JobInfoHeader-title"]') ||
          txt(doc, "h1.jobsearch-JobInfoHeader-title") ||
          txt(doc, "h1");
        const university =
          txt(doc, '[data-testid="inlineHeader-companyName"]') ||
          txt(doc, '[data-company-name="true"]');
        return { position, department: "", university };
      }
    }
  ];

  const GENERIC = {
    id: "generic",
    name: "Generic (heuristic)",
    match: () => true,
    selectorHints: {},
    detectContext(doc) {
      const position = txt(doc, "h1") || metaContent(doc, "og:title") || (doc.title || "").split(/[-|–]/)[0].trim();
      return { position, department: "", university: "" };
    }
  };

  function detectAdapter(url) {
    const found = adapters.find((a) => {
      try { return a.match(url); } catch (e) { return false; }
    });
    return found || GENERIC;
  }

  return { adapters, GENERIC, detectAdapter };
});
