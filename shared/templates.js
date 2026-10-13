/* ApplyFlow — shared/cover-letter placeholder templating
   Placeholders: {{position}}, {{department}}, {{university}}, plus
   convenience {{date}} (today, long form), {{field}}, {{firstName}},
   {{lastName}}, {{fullName}}. Unknown placeholders are left untouched so a
   typo is visible instead of silently dropped.
   Works as a browser global (ApplyFlowTemplates) and as a Node module. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ApplyFlowTemplates = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Placeholder names are matched case-insensitively; canonical (lowercase) forms.
  const KNOWN = ["position", "department", "university", "field", "date", "firstname", "lastname", "fullname"];

  function todayLong() {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    const d = new Date();
    return months[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  // context: { position, department, university, field, firstName, lastName, date }
  function substitutePlaceholders(text, context) {
    if (typeof text !== "string") return "";
    const ctx = context || {};
    const values = {
      position: ctx.position || "",
      department: ctx.department || "",
      university: ctx.university || "",
      field: ctx.field || "",
      date: ctx.date || todayLong(),
      firstname: ctx.firstName || ctx.firstname || "",
      lastname: ctx.lastName || ctx.lastname || "",
      fullname: ctx.fullName || ctx.fullname ||
        [ctx.firstName || ctx.firstname, ctx.lastName || ctx.lastname].filter(Boolean).join(" ")
    };
    return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, name) => {
      const key = name.toLowerCase();
      if (key in values) return values[key];
      return match; // unknown placeholder: leave as-is
    });
  }

  // List the distinct placeholder names present in a template.
  function listPlaceholders(text) {
    if (typeof text !== "string") return [];
    const found = [];
    const re = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(text))) {
      const key = m[1].toLowerCase();
      if (!found.includes(key)) found.push(key);
    }
    return found;
  }

  // Warn about placeholders that are not recognized.
  function unknownPlaceholders(text) {
    return listPlaceholders(text).filter((p) => !KNOWN.includes(p));
  }

  return { KNOWN, substitutePlaceholders, listPlaceholders, unknownPlaceholders, todayLong };
});
