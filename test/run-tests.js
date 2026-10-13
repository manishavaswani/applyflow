/* ApplyFlow — Node unit tests
   Covers: manifest validation, generic field-label matcher (fixture table),
   placeholder substitution, profile schema validation, value mapping.
   Run: node test/run-tests.js */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const schema = require(path.join(ROOT, "shared/schema.js"));
const templates = require(path.join(ROOT, "shared/templates.js"));
const match = require(path.join(ROOT, "shared/match.js"));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? " — " + detail : "")); }
}
function eq(name, got, want) {
  check(name, got === want, "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
}

/* ============ 1. manifest.json validation ============ */
{
  const raw = fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8");
  let m = null, parseErr = null;
  try { m = JSON.parse(raw); } catch (e) { parseErr = e; }
  check("manifest.json parses as JSON", !!m, parseErr && parseErr.message);
  if (m) {
    eq("manifest_version is 3", m.manifest_version, 3);
    check("has name", typeof m.name === "string" && m.name.length > 0);
    check("has version", typeof m.version === "string" && m.version.length > 0);
    check("has description", typeof m.description === "string" && m.description.length > 0);
    check("has icons", m.icons && m.icons["128"] && m.icons["16"]);
    check("action.default_popup set", m.action && typeof m.action.default_popup === "string");
    check("options_page set", typeof m.options_page === "string");
    check("background.service_worker set", m.background && typeof m.background.service_worker === "string");
    check("background.scripts set (Firefox event page)", m.background && Array.isArray(m.background.scripts));
    check("content_scripts present", Array.isArray(m.content_scripts) && m.content_scripts.length > 0);
    const cs = m.content_scripts[0];
    check("content script matches http(s)", cs.matches.includes("https://*/*"));
    check("permissions include storage", m.permissions.includes("storage"));
    check("no remote host_permissions", !m.host_permissions || m.host_permissions.length === 0);
    check("gecko id set", m.browser_specific_settings && !!m.browser_specific_settings.gecko.id);
    // referenced files exist
    const files = [
      m.action.default_popup, m.options_page, m.background.service_worker,
      ...cs.js, ...cs.css,
      m.icons["16"], m.icons["32"], m.icons["48"], m.icons["128"]
    ];
    for (const f of files) {
      check("manifest file exists: " + f, fs.existsSync(path.join(ROOT, f)));
    }
  }
}

/* ============ 2. generic field-label matcher fixture table ============ */
// Each: [label-ish signature, expected key]. Signature is the combined
// label/name/placeholder text a portal would expose.
const FIXTURES = [
  [{ label: "First Name" }, "firstName"],
  [{ label: "Legal First Name" }, "firstName"],
  [{ label: "Given name" }, "firstName"],
  [{ label: "Last Name" }, "lastName"],
  [{ label: "Family Name (Surname)" }, "lastName"],
  [{ label: "Full Name" }, "fullName"],
  [{ label: "Name" }, "fullName"],
  [{ label: "Email Address" }, "email"],
  [{ label: "E-mail" }, "email"],
  [{ label: "Primary email" }, "email"],
  [{ label: "Phone Number" }, "phone"],
  [{ label: "Mobile Phone" }, "phone"],
  [{ label: "Telephone" }, "phone"],
  [{ label: "Street Address" }, "address1"],
  [{ label: "Address Line 1" }, "address1"],
  [{ label: "Address Line 2" }, "address2"],
  [{ label: "Apt / Suite" }, "address2"],
  [{ label: "City" }, "city"],
  [{ label: "State / Province" }, "state"],
  [{ label: "ZIP / Postal Code" }, "zip"],
  [{ label: "Postal code" }, "zip"],
  [{ label: "Country" }, "country"],
  [{ label: "LinkedIn Profile URL" }, "linkedin"],
  [{ label: "LinkedIn" }, "linkedin"],
  [{ label: "Personal Website" }, "homepage"],
  [{ label: "Homepage" }, "homepage"],
  [{ label: "Google Scholar Profile" }, "scholar"],
  [{ label: "ORCID iD" }, "orcid"],
  [{ label: "Cover Letter" }, "coverLetter"],
  [{ label: "Please paste your cover letter" }, "coverLetter"],
  [{ label: "Research Statement" }, "researchStatement"],
  [{ label: "Statement of Teaching Philosophy" }, "teachingStatement"],
  [{ label: "Diversity, Equity, and Inclusion Statement" }, "diversityStatement"],
  [{ label: "Personal Statement" }, "personalStatement"],
  [{ label: "Upload your CV" }, "cv"],
  [{ label: "Curriculum Vitae" }, "cv"],
  [{ label: "Unofficial Transcript" }, "transcripts"],
  [{ label: "How did you hear about us?" }, "referral"],
  [{ label: "Desired Salary" }, "salary"],
  [{ label: "Available Start Date" }, "startDate"],
  [{ label: "When can you start?" }, "startDate"],
  [{ label: "Institution" }, "institution"],
  [{ label: "University" }, "institution"],
  [{ label: "Highest Degree Earned" }, "degree"],
  [{ label: "Field of Study" }, "fieldOfStudy"],
  [{ label: "Graduation Date" }, "graduationDate"],
  [{ label: "Gender" }, "gender"],
  [{ label: "Race / Ethnicity" }, "race"],
  [{ label: "Are you Hispanic or Latino?" }, "hispanic"],
  [{ label: "Veteran Status" }, "veteran"],
  [{ label: "Disability Status" }, "disability"],
  [{ label: "Are you authorized to work in the United States?" }, "workAuthorization"],
  // attribute-driven matches
  [{ name: "applicant_email" }, "email"],
  [{ autocomplete: "given-name" }, "firstName"],
  [{ autocomplete: "family-name" }, "lastName"],
  [{ autocomplete: "postal-code" }, "zip"],
  [{ placeholder: "e.g. https://linkedin.com/in/you" }, "linkedin"],
  // negative cases: must NOT match
  [{ label: "Password" }, null],
  [{ label: "Re-enter password" }, null],
  [{ label: "Search jobs" }, null],
  [{ label: "Comments for the committee" }, null],
];
for (const [sig, want] of FIXTURES) {
  const got = match.matchField(Object.assign({ tag: "input", type: "text" }, sig));
  eq("match: " + JSON.stringify(sig), got, want);
}

/* ============ 3. placeholder substitution ============ */
{
  const ctx = { position: "Assistant Professor", department: "Dept. of History", university: "State University" };
  eq("substitution basic",
    templates.substitutePlaceholders("Apply for {{position}} in {{department}} at {{university}}.", ctx),
    "Apply for Assistant Professor in Dept. of History at State University.");
  eq("substitution tolerates spaces",
    templates.substitutePlaceholders("{{ position }} / {{  university }}", ctx),
    "Assistant Professor / State University");
  check("unknown placeholder left as-is",
    templates.substitutePlaceholders("Hi {{boss}}", ctx).includes("{{boss}}"));
  eq("no placeholders", templates.substitutePlaceholders("plain text", ctx), "plain text");
  check("date filled", /\w+ \d{1,2}, \d{4}/.test(templates.substitutePlaceholders("{{date}}", {})));
  eq("fullName composed",
    templates.substitutePlaceholders("{{fullName}}", { firstName: "Ada", lastName: "Lovelace" }),
    "Ada Lovelace");
  eq("listPlaceholders", templates.listPlaceholders("{{position}} {{bad}} {{position}}").join(","), "position,bad");
  eq("unknownPlaceholders", templates.unknownPlaceholders("{{position}} {{bad}}").join(","), "bad");
}

/* ============ 4. profile schema validation ============ */
{
  const empty = schema.emptyProfile();
  const v1 = schema.validateProfile(empty);
  check("empty profile is valid", v1.ok, v1.errors.join(";"));

  const good = schema.emptyProfile();
  good.personal.firstName = "Ada";
  good.education.push({ institution: "MIT", degree: "PhD", field: "CS", startYear: "2015", endYear: "2020" });
  good.references.push({ name: "Ref One", title: "Prof.", email: "r@x.edu", phone: "555" });
  good.documents.cv.base64 = "SGVsbG8=";
  check("populated profile is valid", schema.validateProfile(good).ok);

  const vBad = schema.validateProfile({ personal: { firstName: 42 } });
  check("rejects non-string personal field", !vBad.ok && vBad.errors.some((e) => e.includes("firstName")));
  const vBad2 = schema.validateProfile({ documents: { cv: { base64: "not base64!!!" } } });
  check("rejects bad base64", !vBad2.ok);
  const vBad3 = schema.validateProfile({ documents: { bogus: {} } });
  check("rejects unknown document kind", !vBad3.ok);
  const vBad4 = schema.validateProfile({ education: "nope" });
  check("rejects non-array education", !vBad4.ok);
  const vBad5 = schema.validateProfile("a string");
  check("rejects non-object profile", !vBad5.ok);

  // normalize: coerces, drops unknowns, keeps arrays
  const n = schema.normalizeProfile({
    personal: { firstName: "Ada", hacker: "drop me" },
    education: [{ institution: "MIT", degree: "PhD", field: "CS", startYear: "2015", endYear: "2020" }, "junk"],
    coverLetters: [{ id: "x", name: "T", text: "Dear {{university}}" }]
  });
  eq("normalize keeps firstName", n.personal.firstName, "Ada");
  check("normalize drops unknown key", !("hacker" in n.personal));
  eq("normalize drops junk array rows", n.education.length, 1);
  eq("normalize keeps cover letter text", n.coverLetters[0].text, "Dear {{university}}");
  eq("normalize fills missing version", n.version, schema.PROFILE_VERSION);
  check("normalize output validates", schema.validateProfile(n).ok);

  // regression: normalize must preserve document base64
  const n2 = schema.normalizeProfile({ documents: { cv: { fileName: "cv.pdf", mimeType: "application/pdf", base64: "SGVsbG8=", text: "Hello", updatedAt: 123 } } });
  eq("normalize keeps document base64", n2.documents.cv.base64, "SGVsbG8=");
  eq("normalize keeps document text", n2.documents.cv.text, "Hello");
  eq("normalize keeps document updatedAt", n2.documents.cv.updatedAt, 123);
}

/* ============ 5. valueForKey mapping ============ */
{
  const p = schema.emptyProfile();
  p.personal.firstName = "Ada";
  p.personal.lastName = "Lovelace";
  p.personal.email = "ada@example.edu";
  p.education.push({ institution: "MIT", degree: "PhD", field: "CS", startYear: "2015", endYear: "2020" });
  p.application.startDate = "August 2026";
  p.coverLetters = [{ id: "default", name: "Default", text: "Dear {{university}} hiring team, re: {{position}}", fileName: "", mimeType: "", base64: "", updatedAt: 0 }];
  const ctx = { position: "Assistant Professor", university: "State University" };
  eq("valueForKey fullName", match.valueForKey(p, "fullName", ctx), "Ada Lovelace");
  eq("valueForKey email", match.valueForKey(p, "email", ctx), "ada@example.edu");
  eq("valueForKey institution (education first)", match.valueForKey(p, "institution", ctx), "MIT");
  eq("valueForKey graduationDate", match.valueForKey(p, "graduationDate", ctx), "2020");
  eq("valueForKey startDate", match.valueForKey(p, "startDate", ctx), "August 2026");
  eq("valueForKey coverLetter substitutes",
    match.valueForKey(p, "coverLetter", ctx, { templates }),
    "Dear State University hiring team, re: Assistant Professor");
  eq("valueForKey empty field", match.valueForKey(p, "linkedin", ctx), "");
}

/* ============ 6. site adapter detection ============ */
{
  const adapters = require(path.join(ROOT, "content/adapters.js"));
  eq("workday host", adapters.detectAdapter("https://harvard.wd1.myworkdayjobs.com/en-US/jobs/job/123").id, "workday");
  eq("workday plain host", adapters.detectAdapter("https://yale.myworkdayjobs.com/jobs").id, "workday");
  eq("interfolio", adapters.detectAdapter("https://apply.interfolio.com/12345").id, "interfolio");
  eq("ajo", adapters.detectAdapter("https://academicjobsonline.org/ajo/jobs/123").id, "academicjobsonline");
  eq("linkedin", adapters.detectAdapter("https://www.linkedin.com/jobs/view/123").id, "linkedin");
  eq("indeed", adapters.detectAdapter("https://www.indeed.com/viewjob?jk=abc").id, "indeed");
  eq("indeed smartapply", adapters.detectAdapter("https://smartapply.indeed.com/beta/indeedapply/form/contact-info").id, "indeed");
  eq("unknown → generic", adapters.detectAdapter("https://jobs.example.edu/posting/1").id, "generic");
}

/* ============ summary ============ */
console.log("\nApplyFlow unit tests: " + pass + " passed, " + fail + " failed.");
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
console.log("All unit tests passed.");
