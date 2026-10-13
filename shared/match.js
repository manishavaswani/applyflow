/* ApplyFlow — shared/generic field matcher
   Maps a form field's observable signals (label text, name/id attributes,
   placeholder, autocomplete, aria-label) to a canonical profile field key.
   Pure logic, no DOM access: takes a plain signature object so it is unit
   testable in Node. Browser global: ApplyFlowMatch. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ApplyFlowMatch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // HTML autocomplete attribute tokens → profile keys (most reliable signal).
  const AUTOCOMPLETE_MAP = {
    "given-name": "firstName",
    "additional-name": "firstName",
    "family-name": "lastName",
    name: "fullName",
    email: "email",
    tel: "phone",
    "tel-national": "phone",
    "street-address": "address1",
    "address-line1": "address1",
    "address-line2": "address2",
    "address-line3": "address2",
    "address-level2": "city",
    "address-level1": "state",
    "postal-code": "zip",
    country: "country",
    "country-name": "country",
    url: "homepage",
    organization: "institution",
    "organization-title": "positionTitle"
  };

  // Ordered rules. First match wins — order is significant (e.g. "last name"
  // must be checked before plain "name"; orcid before generic url/website).
  // Each rule: { key, re } tested against the normalized signature string.
  const RULES = [
    { key: "orcid", re: /\borcid\b/ },
    { key: "scholar", re: /google scholar|scholar profile|scholar url/ },
    { key: "linkedin", re: /linkedin/ },
    { key: "coverLetter", re: /cover\s*letter|covering letter|letter of (interest|application|motivation)|motivation letter/ },
    { key: "researchStatement", re: /research (statement|summary|interests|plan|proposal|philosophy)|statement of research/ },
    { key: "teachingStatement", re: /teaching (statement|philosophy|interests|experience)|statement of teaching/ },
    { key: "diversityStatement", re: /diversity|equity (statement|contribution)|inclusion statement|dei\b|contributions? to (diversity|inclusive)/ },
    { key: "personalStatement", re: /personal statement|statement of purpose/ },
    { key: "transcripts", re: /transcript/ },
    { key: "cv", re: /\bcv\b|curriculum vitae|\bresume\b|\brésumé\b/ },
    { key: "lastName", re: /(last|family|sur)\s*name|surname|\blname\b/ },
    { key: "firstName", re: /(first|given|fore)\s*name|\bfname\b|preferred name/ },
    { key: "middleName", re: /middle\s*(name|initial)/ },
    { key: "fullName", re: /^(your |full |legal )?name$|full name|applicant name|candidate name|\bname\b(?!.*(user|file|doc|letter|template|institution|company|school|universit))/ },
    { key: "email", re: /e[\s-]?mail/ },
    { key: "phone", re: /phone|telephone|\bmobile\b|\bcell(ular)?\b|\btel\b|contact number/ },
    { key: "address2", re: /address\s*(line\s*)?2|street\s*2|apartment|apt\.?\s*(#|no|number|unit)?|\bunit\b|suite/ },
    { key: "address1", re: /street\s*(address)?|address\s*(line\s*)?1?\b|mailing address/ },
    { key: "zip", re: /\bzip\b|postal|postcode/ },
    { key: "city", re: /\bcity\b|town\b|locality/ },
    { key: "state", re: /\bstate\b|province|region/ },
    { key: "country", re: /\bcountry\b/ },
    { key: "homepage", re: /(personal |professional )?(web\s?site|web\s?page|homepage|home page|portfolio)|\burl\b|web address/ },
    { key: "referral", re: /how did you hear|hear about (this|us|the|our)|source of (referral|application)|referral source|where did you (see|find)/ },
    { key: "salary", re: /salary|compensation|pay expectation/ },
    { key: "startDate", re: /start date|date.*(start|available|begin)|available.*(start|date)|earliest.*date|when can you (start|begin)|availability/ },
    { key: "graduationDate", re: /graduation|degree (date|received|completed|year)|completion date|date (of )?(degree|completion)/ },
    { key: "fieldOfStudy", re: /field of (study|research)|discipline|major\b|area of (study|specialization|expertise)|specialization/ },
    { key: "degree", re: /\bdegree\b|highest (degree|education)|education level|qualification/ },
    { key: "institution", re: /institution|university|college|\bschool\b|employer|organization|organisation|company/ },
    { key: "positionTitle", re: /(current|job|position) title|title\b|position held|rank\b/ },
    { key: "department", re: /department/ },
    { key: "gender", re: /\bgender\b|\bsex\b|pronouns/ },
    { key: "race", re: /\brace\b|ethnicity|ethnic origin|racial/ },
    { key: "hispanic", re: /hispanic|latino|latina|latinx/ },
    { key: "veteran", re: /veteran|military (service|status)|armed forces/ },
    { key: "disability", re: /disabilit|disabled|handicap/ },
    { key: "workAuthorization", re: /authorized? to work|work (authorization|permit|visa)|visa status|eligible to work|sponsor/ },
    { key: "referenceName", re: /referee|reference.*name|name.*reference/ }
  ];

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[_\-./\\:()[\]{}*#?!,;|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* signature: { label, name, id, placeholder, autocomplete, ariaLabel,
                  tag, type, options (for selects/radios, optional) }
     returns a canonical key string or null. */
  function matchField(sig) {
    if (!sig || typeof sig !== "object") return null;
    // 1) autocomplete attribute is authoritative. Tokens are case-insensitive
    //    but hyphenated ("given-name"), so lowercase without stripping.
    const ac = String(sig.autocomplete || "").toLowerCase().trim();
    if (ac) {
      const token = ac.split(/\s+/).filter((t) => t in AUTOCOMPLETE_MAP)[0];
      if (token) return AUTOCOMPLETE_MAP[token];
    }
    // 2) Build a combined signature, most specific fields first.
    const parts = [sig.label, sig.ariaLabel, sig.placeholder, sig.name, sig.id]
      .map(norm)
      .filter(Boolean);
    const hay = parts.join(" | ");
    if (!hay) return null;
    // id/name attribute conventions used by big platforms
    if (/\b(email)\b/.test(norm(sig.name))) return "email";
    for (const rule of RULES) {
      if (rule.re.test(hay)) return rule.key;
    }
    return null;
  }

  /* Map a canonical key to a concrete value from a profile.
     context: detected job context {position, department, university, field}
     opts: { templates: shared/templates module (for cover letter
             substitution), coverLetterId } */
  function valueForKey(profile, key, context, opts) {
    if (!profile) return "";
    const ctx = context || {};
    const optsSafe = opts || {};
    const p = profile.personal || {};
    const edu = (profile.education && profile.education[0]) || {}; // index 0 = most recent
    const app = profile.application || {};
    const eeo = profile.eeo || {};
    const pos = profile.position || {};
    switch (key) {
      case "firstName": return p.firstName || "";
      case "lastName": return p.lastName || "";
      case "middleName": return "";
      case "fullName": return [p.firstName, p.lastName].filter(Boolean).join(" ");
      case "email": return p.email || "";
      case "phone": return p.phone || "";
      case "address1": return p.address1 || "";
      case "address2": return p.address2 || "";
      case "city": return p.city || "";
      case "state": return p.state || "";
      case "zip": return p.zip || "";
      case "country": return p.country || "";
      case "homepage": return p.homepage || "";
      case "scholar": return p.scholar || "";
      case "orcid": return p.orcid || "";
      case "linkedin": return p.linkedin || "";
      case "referral": return app.referral || "";
      case "salary": return app.salary || "";
      case "startDate": return app.startDate || "";
      case "workAuthorization": return app.workAuthorization || "";
      case "graduationDate": return edu.endYear || "";
      case "fieldOfStudy": return edu.field || "";
      case "degree": return edu.degree || "";
      case "institution": return edu.institution || pos.institution || "";
      case "positionTitle": return pos.title || "";
      case "department": return pos.department || ctx.department || "";
      case "gender": return eeo.gender || "";
      case "race": return eeo.race || "";
      case "hispanic": return eeo.hispanic || "";
      case "veteran": return eeo.veteran || "";
      case "disability": return eeo.disability || "";
      case "referenceName": {
        const r = (profile.references && profile.references[0]) || {};
        return r.name || "";
      }
      case "coverLetter": {
        const letters = profile.coverLetters || [];
        const chosen =
          letters.find((c) => c.id === optsSafe.coverLetterId) || letters[0];
        if (!chosen || !chosen.text) return "";
        if (optsSafe.templates && optsSafe.templates.substitutePlaceholders) {
          return optsSafe.templates.substitutePlaceholders(chosen.text, Object.assign({
            firstName: p.firstName, lastName: p.lastName
          }, ctx));
        }
        return chosen.text;
      }
      case "researchStatement":
        return (profile.documents && profile.documents.research && profile.documents.research.text) || "";
      case "teachingStatement":
        return (profile.documents && profile.documents.teaching && profile.documents.teaching.text) || "";
      case "diversityStatement":
        return (profile.documents && profile.documents.diversity && profile.documents.diversity.text) || "";
      case "personalStatement":
        return (profile.documents && profile.documents.personal && profile.documents.personal.text) || "";
      case "cv":
      case "transcripts":
        return ""; // file-only keys, no text value
      default:
        return "";
    }
  }

  // Document-kind keys that map to the file store (for file inputs).
  const FILE_DOC_KEYS = {
    cv: "cv",
    coverLetter: "coverLetter",
    researchStatement: "research",
    teachingStatement: "teaching",
    diversityStatement: "diversity",
    personalStatement: "personal",
    transcripts: "transcripts"
  };

  return { AUTOCOMPLETE_MAP, RULES, FILE_DOC_KEYS, norm, matchField, valueForKey };
});
