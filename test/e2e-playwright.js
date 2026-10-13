/* ApplyFlow — end-to-end verification with real Chromium + Playwright.
   Loads the unpacked extension, seeds a profile via the extension's options
   page (chrome.storage.local), serves a fixture application form over HTTP,
   clicks the floating panel's "Fill this page", and asserts field values,
   highlights, radio selection, textarea substitution, and file injection.
   Run: NODE_PATH=<global node_modules> node test/e2e-playwright.js */
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..");

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

async function main() {
  const { chromium } = require("playwright");

  // Tiny static server for the fixture (content scripts match http/https only).
  const server = http.createServer((req, res) => {
    const file = path.join(__dirname, req.url === "/" ? "fixture-form.html" : req.url.replace(/^\//, ""));
    try {
      const body = fs.readFileSync(file);
      res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : "application/octet-stream" });
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end("nope");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "applyflow-pw-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // headful under xvfb: headless shell has no extension support
    args: [
      "--disable-extensions-except=" + ROOT,
      "--load-extension=" + ROOT,
      "--no-sandbox"
    ]
  });

  try {
    // Find the extension ID from the background service worker target.
    let extensionId = null;
    for (let i = 0; i < 20 && !extensionId; i++) {
      for (const sw of context.serviceWorkers()) {
        const m = sw.url().match(/^chrome-extension:\/\/([a-p]{32})\//);
        if (m) extensionId = m[1];
      }
      if (!extensionId) await new Promise((r) => setTimeout(r, 250));
    }
    check("extension service worker registered", !!extensionId);
    if (!extensionId) throw new Error("no extension id");

    // Seed the profile via the options page (has chrome.storage access).
    const opts = await context.newPage();
    await opts.goto("chrome-extension://" + extensionId + "/profile/profile.html");
    const seeded = await opts.evaluate(async () => {
      const schema = globalThis.ApplyFlowSchema;
      const p = schema.emptyProfile();
      p.personal.firstName = "Ada";
      p.personal.lastName = "Lovelace";
      p.personal.email = "ada@example.edu";
      p.personal.phone = "+1 555 0100";
      p.personal.address1 = "12 Analytical Lane";
      p.personal.city = "Cambridge";
      p.personal.zip = "02139";
      p.personal.country = "United States";
      p.personal.linkedin = "https://www.linkedin.com/in/ada";
      p.application.startDate = "August 2026";
      p.application.referral = "HigherEdJobs";
      p.eeo.gender = "Woman";
      p.coverLetters = [{
        id: "default", name: "Default",
        text: "Dear {{university}} committee, I apply for {{position}}.",
        fileName: "", mimeType: "", base64: "", updatedAt: Date.now()
      }];
      // Tiny valid-enough "PDF" bytes as the stored CV.
      p.documents.cv = {
        fileName: "lovelace-cv.pdf", mimeType: "application/pdf",
        base64: btoa("%PDF-1.4 fixture cv bytes"), text: "CV TEXT",
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({ [schema.STORAGE_KEY]: p });
      const got = await chrome.storage.local.get(schema.STORAGE_KEY);
      return got[schema.STORAGE_KEY].personal.firstName === "Ada";
    });
    check("profile seeded into chrome.storage.local", seeded);
    await opts.close();

    // Load the fixture application form; content script should inject panel.
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:" + port + "/fixture-form.html");
    await page.waitForSelector("#applyflow-panel-host", { timeout: 8000, state: "attached" });
    check("floating panel injected on form page", true);

    const adapterText = await page.evaluate(() => {
      const host = document.getElementById("applyflow-panel-host");
      return host.shadowRoot.querySelector(".adapter").textContent;
    });
    check("panel reports generic adapter", /Generic/.test(adapterText), adapterText);

    const ctxText = await page.evaluate(() => {
      const host = document.getElementById("applyflow-panel-host");
      const el = host.shadowRoot.querySelector(".ctx");
      return el ? el.textContent : "";
    });
    check("job context detected from fixture (position/university)",
      /Assistant Professor of Sociology/.test(ctxText), ctxText);

    // Click "Fill this page" in the shadow-DOM panel.
    await page.evaluate(() => {
      const host = document.getElementById("applyflow-panel-host");
      host.shadowRoot.querySelector('[data-act="fill"]').click();
    });
    await page.waitForTimeout(700);

    const vals = await page.evaluate(() => ({
      fname: document.getElementById("fname").value,
      lname: document.getElementById("lname").value,
      email: document.getElementById("email").value,
      phone: document.getElementById("phone").value,
      addr: document.getElementById("addr").value,
      city: document.getElementById("city").value,
      zip: document.getElementById("zip").value,
      country: document.getElementById("country").value,
      linkedin: document.getElementById("li").value,
      start: document.getElementById("start").value,
      hear: document.getElementById("hear").value,
      cover: document.getElementById("cl").value,
      gender: (document.querySelector('input[name="gender"]:checked') || {}).value || "",
      cvFiles: document.getElementById("cvfile").files.length,
      cvName: document.getElementById("cvfile").files[0] ? document.getElementById("cvfile").files[0].name : "",
      highlights: document.querySelectorAll(".applyflow-filled").length,
      resultsText: (() => {
        const host = document.getElementById("applyflow-panel-host");
        const res = host.shadowRoot.querySelector(".results");
        return res ? res.textContent : "";
      })()
    }));

    check("first name filled", vals.fname === "Ada", vals.fname);
    check("last name filled", vals.lname === "Lovelace", vals.lname);
    check("email filled", vals.email === "ada@example.edu", vals.email);
    check("phone filled", vals.phone === "+1 555 0100", vals.phone);
    check("street filled", vals.addr === "12 Analytical Lane", vals.addr);
    check("city filled", vals.city === "Cambridge", vals.city);
    check("zip filled", vals.zip === "02139", vals.zip);
    check("country select filled", vals.country === "US", vals.country);
    check("linkedin filled", vals.linkedin === "https://www.linkedin.com/in/ada", vals.linkedin);
    check("start date filled", vals.start === "August 2026", vals.start);
    check("referral filled", vals.hear === "HigherEdJobs", vals.hear);
    check("cover letter substituted with context",
      vals.cover === "Dear  committee, I apply for Assistant Professor of Sociology.", vals.cover);
    check("gender radio selected", vals.gender === "w", vals.gender);
    check("CV file injected via DataTransfer", vals.cvFiles === 1, "files=" + vals.cvFiles);
    check("injected file has original name", vals.cvName === "lovelace-cv.pdf", vals.cvName);
    check("fields highlighted", vals.highlights >= 10, "count=" + vals.highlights);
    check("panel lists results", /Filled \d+ field/.test(vals.resultsText), vals.resultsText.slice(0, 80));
  } finally {
    await context.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log("\nE2E: " + pass + " passed, " + fail + " failed.");
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error("E2E harness error:", e.message);
  process.exit(2);
});
