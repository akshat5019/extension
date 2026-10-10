import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { PDFDocument, StandardFonts } from "pdf-lib";
import ExcelJS from "exceljs";
import { zipSync, strToU8 } from "fflate";
let server, context, background, popup, job, temporary, url;
const fixture = `<!doctype html><title>Registration</title><h1>Register</h1><form>
<label>Full Name<input id="name"></label><label>Mobile Number<input id="phone" type="tel"></label><label>Email Address<input id="email" type="email"></label><label>Home Address<textarea id="address" required></textarea></label><label>Country<select id="country"><option value="">Choose</option><option value="IN">India</option><option value="US">United States</option></select></label>
<label>Date of birth<input id="dob" type="date"></label><fieldset><legend>Preferred contact</legend><label>Phone<input type="radio" name="contact" value="phone"></label><label>Email<input type="radio" name="contact" value="email"></label></fieldset><label>I agree to terms<input type="checkbox" id="consent"></label><label>Bank account number<input id="bank"></label><input type="password" id="password"><button type="submit">Submit</button></form><script>window.submitted=false;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submitted=true});</script>`;
async function setupContext() {
  context = await chromium.launchPersistentContext(temporary, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
    viewport: { width: 1100, height: 900 },
  });
  const local = {},
    session = {},
    permissions = new Set();
  await context.exposeBinding("__runtime", async ({ page }, message) => {
    const sender = {
      id: "test-extension",
      url: page.url(),
      ...(page === job
        ? { tab: { id: 1 }, frameId: 0 }
        : new URL(page.url()).pathname === "/manager.html"
          ? { tab: { id: 2 }, frameId: 0 }
          : {}),
    };
    return background.evaluate(
      ({ message, sender }) =>
        new Promise((resolve) => {
          let waiting = false,
            answered = false;
          const respond = (v) => {
            answered = true;
            resolve(v);
          };
          for (const listener of window.__listeners)
            if (listener(message, sender, respond) === true) waiting = true;
          if (!waiting && !answered) resolve(undefined);
        }),
      { message, sender },
    );
  });
  await context.exposeBinding("__storage", async (_s, area, action, data) => {
    const store = area === "local" ? local : session;
    if (action === "get")
      return Object.fromEntries(
        (typeof data === "string"
          ? [data]
          : Array.isArray(data)
            ? data
            : Object.keys(store)
        )
          .filter((k) => k in store)
          .map((k) => [k, store[k]]),
      );
    if (action === "set") Object.assign(store, data);
    if (action === "remove")
      for (const k of Array.isArray(data) ? data : [data]) delete store[k];
    if (action === "clear") for (const k of Object.keys(store)) delete store[k];
  });
  await context.exposeBinding("__permissions", async (_s, action, origins) => {
    if (action === "getAll") return { origins: [...permissions] };
    if (action === "request") {
      origins.forEach((x) => permissions.add(x));
      return true;
    }
    if (action === "remove") {
      origins.forEach((x) => permissions.delete(x));
      return true;
    }
    return origins.every((x) => permissions.has(x));
  });
  await context.exposeBinding("__tabs", async () => [
    { id: 1, url: job?.url() },
  ]);
  await context.exposeBinding("__inject", async () => {
    await job.addScriptTag({ path: resolve("dist/content.js") });
  });
  await context.exposeBinding("__message", async (_s, message) =>
    job.evaluate(
      (message) =>
        new Promise((resolve) => {
          let handled = false;
          for (const listener of window.__listeners) {
            listener(
              message,
              { id: "test-extension", url: "http://extension/popup.html" },
              (v) => {
                handled = true;
                resolve(v);
              },
            );
          }
          if (!handled) resolve(undefined);
        }),
      message,
    ),
  );
  await context.addInitScript(
    ({ url }) => {
      window.__listeners = [];
      const runtime = {
        id: "test-extension",
        getURL: (path) => `${url}/${path}`,
        onMessage: { addListener: (f) => window.__listeners.push(f) },
        onInstalled: { addListener: () => {} },
        sendMessage: (m) => window.__runtime(m),
      };
      Object.assign(window.chrome, {
        runtime,
        storage: Object.fromEntries(
          ["local", "session"].map((area) => [
            area,
            {
              get: (data) => window.__storage(area, "get", data),
              set: (data) => window.__storage(area, "set", data),
              remove: (data) => window.__storage(area, "remove", data),
              clear: () => window.__storage(area, "clear"),
              setAccessLevel: async () => {},
            },
          ]),
        ),
        permissions: {
          getAll: () => window.__permissions("getAll", []),
          request: ({ origins }) => window.__permissions("request", origins),
          remove: ({ origins }) => window.__permissions("remove", origins),
        },
        tabs: {
          query: () => window.__tabs(),
          create: async () => {},
          sendMessage: (_id, message) => window.__message(message),
        },
        scripting: {
          executeScript: () => window.__inject(),
          getRegisteredContentScripts: async () => [],
          unregisterContentScripts: async () => {},
        },
      });
    },
    { url },
  );
  background = await context.newPage();
  await background.goto(`${url}/background-runner`);
  job = await context.newPage();
  await job.goto(`${url}/fixture`);
  popup = await context.newPage();
  await popup.goto(`${url}/popup.html`);
}
test.beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), "personal-browser-"));
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/fixture") {
      res.setHeader("Content-Type", "text/html");
      res.end(fixture);
      return;
    }
    if (path === "/background-runner") {
      res.setHeader("Content-Type", "text/html");
      res.end('<script src="background.js"></script>');
      return;
    }
    try {
      const bytes = await readFile(join(resolve("dist"), path.slice(1)));
      res.setHeader(
        "Content-Type",
        path.endsWith(".js") || path.endsWith(".mjs")
          ? "application/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.setHeader(
        "Content-Security-Policy",
        "script-src 'self'; object-src 'self'",
      );
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
  await setupContext();
});
test.beforeEach(async () => {
  await popup.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: "DB_CLEAR" });
    if (r.error) throw new Error(r.error);
  });
  await job.goto(`${url}/fixture`);
  await popup.reload();
});
test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise((r) => server.close(r));
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
const csv =
  "Name,Email,Phone,Country,Date of birth,Preferred contact\nRahul Sharma,rahul@example.com,9876543210,India,1990-02-03,phone\nPriya Sharma,priya@example.com,9123456789,India,1992-01-01,email";
async function upload(name, bytes) {
  await popup.getByRole("button", { name: "Import", exact: true }).click();
  await popup.getByLabel("Upload document").setInputFiles({
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes),
  });
  await expect(popup.locator("#status")).toContainText("candidate profiles");
}
async function confirmImport() {
  await popup
    .getByLabel(
      "I reviewed the person boundaries, values and duplicate decisions.",
    )
    .check();
  await popup
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(popup.locator("#status")).toContainText("Import complete");
}
async function select(name) {
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .first()
    .click();
  await popup.locator("#search").fill(name);
  await popup.locator(".person").filter({ hasText: name }).first().click();
}
async function seed() {
  await upload("people.csv", csv);
  await confirmImport();
}

async function confirmAndFill() {
  await popup
    .getByLabel(
      "I reviewed the person boundaries, values and duplicate decisions.",
    )
    .check();
  await popup
    .getByRole("button", { name: "Confirm import & autofill", exact: true })
    .click();
}

test("confirmed PDF import immediately fills the exact imported person instead of an older selection", async () => {
  await seed();
  await select("Priya Sharma");
  await job.evaluate(() => {
    document
      .querySelector("form")
      .insertAdjacentHTML(
        "afterbegin",
        '<label>First Name<input id="given"></label><label>Last Name<input id="family"></label><label>City<input id="city"></label>',
      );
    document.querySelector("#phone").value = "Already entered";
  });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  [
    "Name: Akshat Sharma",
    "Email: akshat@example.com",
    "Phone: 9999988888",
    "City: Pune",
    "Country: India",
  ].forEach((line, i) =>
    page.drawText(line, { x: 40, y: 740 - i * 24, size: 12, font }),
  );
  await upload("resume.pdf", await pdf.save());
  await popup.getByLabel("Record decision").selectOption("create");
  await expect(job.locator("#name")).toHaveValue("");
  await expect(
    popup.getByRole("button", {
      name: "Confirm import & autofill",
      exact: true,
    }),
  ).toBeDisabled();
  await confirmAndFill();
  await expect(popup.locator("#status")).toContainText(
    "fields for Akshat Sharma",
  );
  for (const [id, value] of [
    ["name", "Akshat Sharma"],
    ["given", "Akshat"],
    ["family", "Sharma"],
    ["email", "akshat@example.com"],
    ["city", "Pune"],
    ["country", "IN"],
    ["phone", "Already entered"],
  ])
    await expect(job.locator(`#${id}`)).toHaveValue(value);
  await expect(job.locator("#bank")).toHaveValue("");
  await expect(job.locator("#password")).toHaveValue("");
  await expect(job.locator("#consent")).not.toBeChecked();
  expect(await job.evaluate(() => window.submitted)).toBe(false);
  await popup.getByLabel("Answer Home Address").fill("12 Resume Road");
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await popup
    .getByRole("button", { name: "Confirm save to selected profile" })
    .click();
  await expect(popup.locator("#status")).toContainText("saved to Akshat");
  const people = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_SEARCH", query: "" }))
        .result.items,
  );
  expect(
    people.find((p) => p.fields.email === "akshat@example.com").fields.address,
  ).toBe("12 Resume Road");
  expect(
    people.find((p) => p.fields.email === "priya@example.com").fields.address,
  ).toBeUndefined();
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await expect(job.locator("#name")).toHaveValue("");
  await expect(job.locator("#phone")).toHaveValue("Already entered");
});

test("multiple imported people require selection; a single explicitly retained record uses its own receipt", async () => {
  await upload("people.csv", csv);
  await popup
    .getByLabel(
      "I reviewed the person boundaries, values and duplicate decisions.",
    )
    .check();
  await expect(
    popup.getByRole("button", {
      name: "Confirm import & autofill",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(job.locator("#name")).toHaveValue("");
  await popup.getByLabel("Record decision").selectOption("skip");
  await confirmAndFill();
  await expect(job.locator("#name")).toHaveValue("Priya Sharma");
  const stats = await popup.evaluate(
    async () => (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result,
  );
  expect(stats.total).toBe(1);
  expect(await job.evaluate(() => window.submitted)).toBe(false);
});

test("a failed immediate fill preserves the import and supports retry without importing twice", async () => {
  await upload(
    "single.csv",
    "Name,Email,Country\nJane Doe,jane@example.com,India",
  );
  await popup.evaluate(() => {
    window.originalInject = chrome.scripting.executeScript;
    chrome.scripting.executeScript = async () => {
      throw new Error("Website access denied");
    };
  });
  await confirmAndFill();
  await expect(popup.locator("#status")).toContainText(
    "Your imported information is saved",
  );
  await expect(popup.locator("#status")).toContainText("Website access denied");
  await expect(job.locator("#name")).toHaveValue("");
  expect(
    await popup.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result.total,
    ),
  ).toBe(1);
  await popup.evaluate(() => {
    chrome.scripting.executeScript = window.originalInject;
  });
  await popup.getByRole("button", { name: "Scan & fill", exact: true }).click();
  await expect(job.locator("#name")).toHaveValue("Jane Doe");
});

test("reviewed duplicate update fills the committed revision rather than the previously selected person", async () => {
  await seed();
  const before = await popup.evaluate(
    async () =>
      (
        await chrome.runtime.sendMessage({
          type: "DB_SEARCH",
          query: "rahul@example.com",
        })
      ).result.items[0],
  );
  await select("Priya Sharma");
  await upload(
    "rahul-update.csv",
    "Name,Email,Address\nRahul Sharma,rahul@example.com,Updated Road",
  );
  await popup
    .getByRole("button", { name: "Review update to this profile" })
    .click();
  await confirmAndFill();
  await expect(job.locator("#name")).toHaveValue("Rahul Sharma");
  await expect(job.locator("#address")).toHaveValue("Updated Road");
  const after = await popup.evaluate(
    async () =>
      (
        await chrome.runtime.sendMessage({
          type: "DB_SEARCH",
          query: "rahul@example.com",
        })
      ).result.items[0],
  );
  expect(after.id).toBe(before.id);
  expect(after.revision).toBe(before.revision + 1);
  expect(
    await popup.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result.total,
    ),
  ).toBe(2);
});

test("immediate import fill refuses a target that navigated to another website", async () => {
  await upload("single.csv", "Name,Email\nJane Doe,jane@example.com");
  await job.goto(url.replace("127.0.0.1", "localhost") + "/fixture");
  await confirmAndFill();
  await expect(popup.locator("#status")).toContainText("changed websites");
  await expect(job.locator("#name")).toHaveValue("");
  await expect(job.locator("#email")).toHaveValue("");
  expect(
    await popup.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result.total,
    ),
  ).toBe(1);
});

test("keeps format readers unloaded during startup/CSV import and offers selected-person quick fill", async () => {
  const readerRequests = [];
  const track = (request) => {
    if (
      /\/chunks\/(?:pdf-|mammoth\.browser-|exceljs\.min-)/.test(request.url())
    )
      readerRequests.push(request.url());
  };
  popup.on("request", track);
  await popup.reload();
  await expect(
    popup.getByRole("button", { name: "Scan & fill", exact: true }),
  ).toBeDisabled();
  await seed();
  await select("Rahul Sharma");
  expect(readerRequests).toEqual([]);
  await popup.getByRole("button", { name: "Scan & fill", exact: true }).click();
  await expect(job.locator("#name")).toHaveValue("Rahul Sharma");
  await expect(job.locator("#email")).toHaveValue("rahul@example.com");
  await expect(job.locator("#country")).toHaveValue("IN");
  await expect(job.locator("#address")).toHaveValue("");
  await expect(job.locator("#bank")).toHaveValue("");
  await expect(job.locator("#password")).toHaveValue("");
  await expect(job.locator("#consent")).not.toBeChecked();
  await expect(job.locator("#dob")).toHaveValue("");
  expect(await job.evaluate(() => window.submitted)).toBe(false);
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await expect(job.locator("#email")).toHaveValue("");
  await upload("resume.docx", await readFile("tests/fixtures/resume.docx"));
  expect(readerRequests.some((url) => url.includes("mammoth.browser-"))).toBe(
    true,
  );
  expect(readerRequests.some((url) => /\/(pdf-|exceljs\.min-)/.test(url))).toBe(
    false,
  );
  popup.off("request", track);
});

test("quick fill rescans changed steps without old staged answers and rejects stale profile revisions", async () => {
  await seed();
  await select("Rahul Sharma");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup.getByLabel("Answer Home Address").fill("Old step address");
  await job.evaluate(() => {
    document.querySelector("#address").closest("label").outerHTML =
      '<label>City<input id="city" required></label>';
  });
  await popup.getByRole("button", { name: "Scan & fill", exact: true }).click();
  await expect(job.locator("#city")).toHaveValue("");
  await expect(job.locator("#email")).toHaveValue("rahul@example.com");
  await expect(popup.getByLabel("Answer City")).toHaveValue("");
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await popup.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({
      type: "DB_SEARCH",
      query: "rahul@example.com",
    });
    const person = r.result.items[0];
    const saved = await chrome.runtime.sendMessage({
      type: "DB_SAVE",
      id: person.id,
      revision: person.revision,
      fields: { ...person.fields, email: "updated@example.com" },
    });
    if (saved.error) throw new Error(saved.error);
  });
  await popup.getByRole("button", { name: "Scan & fill", exact: true }).click();
  await expect(popup.locator("#status")).toContainText("Profile changed");
  await expect(job.locator("#name")).toHaveValue("");
  await expect(job.locator("#email")).toHaveValue("");
  expect(await job.evaluate(() => window.submitted)).toBe(false);
});

test("imports an inline PDF resume and fills names, email, city and country without manual answers", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  [
    "Akshat Kumar Sharma | Software Engineer",
    "akshat@example.com | 9876543210 | Pune, Maharashtra, India",
    "Education",
    "National Technical Institute",
    "Projects",
    "Job Application Assistant",
  ].forEach((line, i) =>
    page.drawText(line, { x: 40, y: 740 - i * 24, size: 12, font }),
  );
  await popup
    .getByRole("button", { name: "Import resume", exact: true })
    .click();
  await upload("akshat-resume.pdf", await pdf.save());
  await expect(popup.getByLabel("Full name", { exact: true })).toHaveValue(
    "Akshat Kumar Sharma",
  );
  await expect(popup.getByLabel("First name", { exact: true })).toHaveValue(
    "Akshat",
  );
  await expect(popup.getByLabel("Middle name", { exact: true })).toHaveValue(
    "Kumar",
  );
  await expect(popup.getByLabel("Last name", { exact: true })).toHaveValue(
    "Sharma",
  );
  await expect(popup.getByLabel("City", { exact: true })).toHaveValue("Pune");
  await expect(popup.getByLabel("Country", { exact: true })).toHaveValue(
    "India",
  );
  await expect(popup.getByLabel("Resume autofill summary")).toContainText(
    "Full name, First name, Last name, Email, City, Country",
  );
  await popup.getByLabel("Record decision").selectOption("create");
  await confirmImport();
  await popup.reload();
  await select("Akshat Kumar Sharma");
  await job.evaluate(() => {
    const section = document.createElement("div");
    section.innerHTML =
      '<label>Legal First Name *<input id="given" required></label><label>Middle Name<input id="middle" autocomplete="additional-name"></label><label>Last Name *<input id="family" required></label><label>City<input id="city" required></label><label>Upload Resume<input id="resume-file" type="file" required></label>';
    document.querySelector("form").prepend(section);
  });
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  // Known names should be ready for filling, without asking the user to retype.
  await expect(popup.getByLabel("Answer Legal First Name *")).toHaveCount(0);
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#name")).toHaveValue("Akshat Kumar Sharma");
  await expect(job.locator("#given")).toHaveValue("Akshat");
  await expect(job.locator("#middle")).toHaveValue("Kumar");
  await expect(job.locator("#family")).toHaveValue("Sharma");
  await expect(job.locator("#email")).toHaveValue("akshat@example.com");
  await expect(job.locator("#phone")).toHaveValue("9876543210");
  await expect(job.locator("#city")).toHaveValue("Pune");
  await expect(job.locator("#country")).toHaveValue("IN");
  await expect(job.locator("#resume-file")).toHaveValue("");
  expect(await job.evaluate(() => window.submitted)).toBe(false);
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await expect(job.locator("#given")).toHaveValue("");
  await expect(job.locator("#family")).toHaveValue("");
  await expect(job.locator("#city")).toHaveValue("");
});

test("reads labelled DOCX resume contacts locally and fills the saved profile after reopening", async () => {
  const paragraphs = [
    "Full Name",
    "Jane Doe",
    "Mail",
    "jane@example.com",
    "Current Location",
    "London, UK",
    "Experience",
    "Acme Company, Paris, France",
  ];
  const docx = zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
    ),
  });
  await upload("jane-resume.docx", docx);
  for (const [label, value] of [
    ["Full name", "Jane Doe"],
    ["First name", "Jane"],
    ["Last name", "Doe"],
    ["Email", "jane@example.com"],
    ["City", "London"],
    ["Country", "United Kingdom"],
  ]) {
    await expect(popup.getByLabel(label, { exact: true })).toHaveValue(value);
  }
  await popup.getByLabel("Record decision").selectOption("create");
  await confirmImport();
  await popup.reload();
  await select("Jane Doe");
  await job.evaluate(() => {
    document
      .querySelector("form")
      .insertAdjacentHTML(
        "afterbegin",
        '<label>First name<input id="given"></label><label>Last name<input id="family"></label><label>City<input id="city"></label>',
      );
    document.querySelector("#country").add(new Option("United Kingdom", "GB"));
  });
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  for (const [id, value] of [
    ["name", "Jane Doe"],
    ["given", "Jane"],
    ["family", "Doe"],
    ["email", "jane@example.com"],
    ["city", "London"],
    ["country", "GB"],
  ]) {
    await expect(job.locator(`#${id}`)).toHaveValue(value);
  }
  expect(await job.evaluate(() => window.submitted)).toBe(false);
});

test("fills older full-name-only profiles, preserves existing names and uses native name events", async () => {
  await popup.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({
      type: "DB_SAVE",
      fields: { fullName: "Priya Sharma", email: "priya@example.com" },
    });
    if (r.error) throw new Error(r.error);
  });
  await popup.reload();
  await select("Priya Sharma");
  await job.evaluate(() => {
    const section = document.createElement("div");
    section.innerHTML =
      '<label>First Name<input id="given" value="Already entered"></label><label>Family Name<input id="family"></label>';
    document.querySelector("form").prepend(section);
    window.nameEvents = [];
    document
      .querySelector("#family")
      .addEventListener("input", () => window.nameEvents.push("input"));
    document
      .querySelector("#family")
      .addEventListener("change", () => window.nameEvents.push("change"));
  });
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#given")).toHaveValue("Already entered");
  await expect(job.locator("#family")).toHaveValue("Sharma");
  await expect(job.locator("#name")).toHaveValue("Priya Sharma");
  expect(await job.evaluate(() => window.nameEvents)).toEqual([
    "input",
    "change",
  ]);
  const stored = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_SEARCH", query: "Priya" }))
        .result.items[0],
  );
  expect(stored.fields.firstName).toBeUndefined();
  expect(stored.fields.lastName).toBeUndefined();
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await expect(job.locator("#given")).toHaveValue("Already entered");
  await expect(job.locator("#family")).toHaveValue("");
});

test("extracts analyst resume headings from PDF layout when contact objects precede the name", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [name, email] of [
    ["AKSHAT SHARMA", "analyst@example.com"],
    ["PRIYA", "priya-analyst@example.com"],
  ]) {
    const page = pdf.addPage();
    // Simulate design tools storing contact/sidebar objects before the visible heading.
    page.drawText(email, { x: 320, y: 750, size: 10, font });
    page.drawText("Mumbai Maharashtra", { x: 320, y: 800, size: 10, font });
    page.drawText("Data Analyst", { x: 40, y: 715, size: 14, font });
    page.drawText("Portfolio", { x: 320, y: 725, size: 10, font });
    page.drawText("Education", { x: 40, y: 650, size: 12, font });
    page.drawText("Technical Skills", { x: 320, y: 650, size: 12, font });
    page.drawText("National Technical Institute", {
      x: 40,
      y: 620,
      size: 10,
      font,
    });
    page.drawText("Excel SQL", { x: 320, y: 620, size: 10, font });
    page.drawText("Projects", { x: 40, y: 570, size: 12, font });
    page.drawText("Sales Dashboard", { x: 40, y: 545, size: 10, font });
    page.drawText(name, { x: 40, y: 770, size: 26, font });
  }
  await upload("analyst-resumes.pdf", await pdf.save());
  await expect(popup.getByLabel("Full name", { exact: true })).toHaveValue(
    "AKSHAT SHARMA",
  );
  await expect(popup.getByLabel("First name", { exact: true })).toHaveValue(
    "AKSHAT",
  );
  await expect(popup.getByLabel("Last name", { exact: true })).toHaveValue(
    "SHARMA",
  );
  await expect(
    popup.getByText("Several possible names", { exact: false }),
  ).toHaveCount(0);
  await popup.getByLabel("Record decision").selectOption("create");
  await popup.getByRole("button", { name: "Next record", exact: true }).click();
  await expect(popup.getByLabel("Full name", { exact: true })).toHaveValue(
    "PRIYA",
  );
  await expect(popup.getByLabel("First name", { exact: true })).toHaveValue(
    "PRIYA",
  );
  await popup.getByLabel("Record decision").selectOption("create");
  await confirmImport();
  await select("AKSHAT SHARMA");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#name")).toHaveValue("AKSHAT SHARMA");
  await expect(job.locator("#email")).toHaveValue("analyst@example.com");
  const saved = await popup.evaluate(
    async () =>
      (
        await chrome.runtime.sendMessage({
          type: "DB_SEARCH",
          query: "priya-analyst@example.com",
        })
      ).result.items[0],
  );
  expect(saved.fields.fullName).toBe("PRIYA");
  expect(saved.fields.lastName).toBeUndefined();
});

test("offers selectable names for ambiguous imports without requiring name retyping", async () => {
  await upload(
    "ambiguous-resume.txt",
    "Rahul Sharma\nPriya Gupta\nrahul@example.com\nSkills\nSQL Excel",
  );
  await expect(popup.getByLabel("Full name", { exact: true })).toHaveValue("");
  await popup
    .getByRole("button", { name: "Use Priya Gupta", exact: true })
    .click();
  await expect(popup.getByLabel("Full name", { exact: true })).toHaveValue(
    "Priya Gupta",
  );
  await expect(popup.getByLabel("First name", { exact: true })).toHaveValue(
    "Priya",
  );
  await expect(popup.getByLabel("Last name", { exact: true })).toHaveValue(
    "Gupta",
  );
  await popup
    .getByRole("button", { name: "Use Rahul Sharma", exact: true })
    .click();
  await expect(popup.getByLabel("First name", { exact: true })).toHaveValue(
    "Rahul",
  );
  await expect(popup.getByLabel("Last name", { exact: true })).toHaveValue(
    "Sharma",
  );
  await popup.getByLabel("Record decision").selectOption("create");
  await confirmImport();
  await select("Rahul Sharma");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#name")).toHaveValue("Rahul Sharma");
  const saved = await popup.evaluate(
    async () =>
      (
        await chrome.runtime.sendMessage({
          type: "DB_SEARCH",
          query: "rahul@example.com",
        })
      ).result.items[0],
  );
  expect(saved.fields.firstName).toBe("Rahul");
  expect(saved.fields.lastName).toBe("Sharma");
});

test("fills ATS identifiers, adjacent labels, open shadow components and same-origin embedded applications", async () => {
  await seed();
  await select("Rahul Sharma");
  await job.evaluate(async () => {
    const section = document.createElement("div");
    section.innerHTML =
      '<input id="wd-first" data-automation-id="legalNameSection_firstName" placeholder="Enter"><div><span class="form-label">Last Name *</span><input id="adjacent-last"></div><div id="shadow-host"></div><iframe id="embedded" style="width:600px;height:350px"></iframe>';
    document.querySelector("form").prepend(section);
    const root = document
      .querySelector("#shadow-host")
      .attachShadow({ mode: "open" });
    document.querySelector("#shadow-host").style.display = "contents";
    root.innerHTML =
      '<span id="shadow-label">Given Name</span><input id="shadow-first" aria-labelledby="shadow-label"><label>City<input id="shadow-city" required></label>';
    window.shadowEvents = 0;
    document
      .querySelector("#shadow-host")
      .addEventListener("input", () => window.shadowEvents++);
    const frame = document.querySelector("#embedded");
    await new Promise((resolve) => {
      frame.onload = resolve;
      frame.srcdoc =
        '<form><label>Full Name<input id="frame-name"></label><label>Mobile Number<input id="frame-phone" type="tel"></label><label>Country<select id="frame-country"><option value="">Choose</option><option value="IN">India</option></select></label><label>Date of birth<input id="frame-dob" type="date"></label><fieldset><legend>Preferred contact</legend><label>Phone<input type="radio" name="contact" value="phone"></label><label>Email<input type="radio" name="contact" value="email"></label></fieldset><button>Submit</button></form>';
    });
  });
  await popup
    .getByLabel(
      "Include date of birth and gender from this profile for this fill",
    )
    .check();
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await expect(popup.locator("#status")).toContainText("Workday");
  await expect(popup.locator("#status")).toContainText(
    "Scanned 1 accessible embedded forms",
  );
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#wd-first")).toHaveValue("Rahul");
  await expect(job.locator("#adjacent-last")).toHaveValue("Sharma");
  await expect(job.locator("#shadow-first")).toHaveValue("Rahul");
  expect(await job.evaluate(() => window.shadowEvents)).toBeGreaterThan(0);
  const frame = job.frameLocator("#embedded");
  await expect(frame.locator("#frame-name")).toHaveValue("Rahul Sharma");
  await expect(frame.locator("#frame-phone")).toHaveValue("9876543210");
  await expect(frame.locator("#frame-country")).toHaveValue("IN");
  await expect(frame.locator("#frame-dob")).toHaveValue("1990-02-03");
  await expect(frame.locator('[name="contact"][value="phone"]')).toBeChecked();
  await expect(job.locator('[name="contact"][value="phone"]')).toBeChecked();
  await job.locator("#shadow-city").fill("Pune");
  await popup
    .getByRole("button", { name: "Review answers entered on page" })
    .click();
  await popup
    .getByRole("button", { name: "Confirm save to selected profile" })
    .click();
  await expect(popup.locator("#status")).toContainText("saved to Rahul");
  await frame.locator("#frame-phone").fill("9999999999");
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await expect(frame.locator("#frame-phone")).toHaveValue("9999999999");
  await expect(frame.locator("#frame-name")).toHaveValue("");
  await expect(frame.locator("#frame-country")).toHaveValue("");
  await expect(
    frame.locator('[name="contact"][value="phone"]'),
  ).not.toBeChecked();
  await expect(job.locator("#shadow-first")).toHaveValue("");
  await expect(job.locator("#shadow-city")).toHaveValue("Pune");
  expect(await job.evaluate(() => window.submitted)).toBe(false);
});

test("reports protected frames and custom controls, and invalidates changed embedded steps", async () => {
  await seed();
  await select("Rahul Sharma");
  await job.evaluate(async () => {
    const section = document.createElement("div");
    section.innerHTML =
      '<iframe id="same-origin" style="height:120px"></iframe><iframe id="protected" sandbox="allow-scripts" style="height:120px"></iframe><label>Country<input role="combobox" id="custom-country"></label><div id="hidden-host" style="display:none"></div><label>Reference full name<input id="referee" data-field="fullName"></label>';
    document.querySelector("form").prepend(section);
    document
      .querySelector("#hidden-host")
      .attachShadow({ mode: "open" }).innerHTML =
      '<label>First name<input id="hidden-first"></label>';
    await Promise.all(
      ["same-origin", "protected"].map(
        (id) =>
          new Promise((resolve) => {
            const frame = document.getElementById(id);
            frame.onload = resolve;
            frame.srcdoc =
              '<label>First Name<input id="embedded-first" required></label>';
          }),
      ),
    );
  });
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await expect(popup.locator("#status")).toContainText(
    "1 protected or cross-origin frames",
  );
  await expect(
    popup.getByText("Custom dropdown: choose an option on the website."),
  ).toBeVisible();
  const sameOrigin = job
    .frames()
    .find((frame) => frame.parentFrame() && frame.url() === "about:srcdoc");
  await sameOrigin.evaluate(() => {
    location.hash = "next-step";
  });
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(
    job.frameLocator("#same-origin").locator("#embedded-first"),
  ).toHaveValue("");
  await expect(
    job.frameLocator("#protected").locator("#embedded-first"),
  ).toHaveValue("");
  await expect(job.locator("#custom-country")).toHaveValue("");
  await expect(job.locator("#referee")).toHaveValue("");
  await expect(job.locator("#hidden-first")).toHaveValue("");
  await expect(
    popup.getByText("Field changed since scanning.", { exact: true }),
  ).toBeVisible();
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(
    job.frameLocator("#same-origin").locator("#embedded-first"),
  ).toHaveValue("Rahul");
});

test("imports multiple people, requires selection, fills only one person, confirms learning and supports undo", async () => {
  await seed();
  await select("Rahul Sharma");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await expect(popup.locator("#status")).toContainText("Detected");
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#name")).toHaveValue("Rahul Sharma");
  await expect(job.locator("#phone")).toHaveValue("9876543210");
  await expect(job.locator("#country")).toHaveValue("IN");
  await expect(job.locator("[name=contact][value=phone]")).toBeChecked();
  await expect(job.locator("#address")).toHaveValue("");
  await expect(job.locator("#dob")).toHaveValue("");
  await expect(job.locator("#bank")).toHaveValue("");
  await expect(job.locator("#consent")).not.toBeChecked();
  expect(await job.evaluate(() => window.submitted)).toBe(false);
  await popup.getByLabel("Answer Home Address").fill("12 Lake Road");
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#address")).toHaveValue("12 Lake Road");
  let data = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_SEARCH", query: "Rahul" }))
        .result.items[0],
  );
  expect(data.fields.address).toBeUndefined();
  await popup
    .getByRole("button", { name: "Confirm save to selected profile" })
    .click();
  await expect(popup.locator("#status")).toContainText("saved to Rahul");
  data = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_SEARCH", query: "Priya" }))
        .result.items[0],
  );
  expect(data.fields.address).toBeUndefined();
  await select("Priya Sharma");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(popup.locator("#status")).toContainText("Undo the previous");
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#name")).toHaveValue("Priya Sharma");
  await expect(job.locator("#email")).toHaveValue("priya@example.com");
  await job.locator("#phone").fill("9999999999");
  await popup.getByRole("button", { name: "Undo autofill" }).click();
  await expect(job.locator("#phone")).toHaveValue("9999999999");
  await expect(job.locator("#name")).toHaveValue("");
});
test("finds duplicates, resolves conflicts explicitly, and prevents repeated document writes", async () => {
  await seed();
  await upload(
    "updates.csv",
    "Name,Email,Phone,Address\nRahul Sharma,rahul@example.com,1111111111,Updated Road\nNew Person,new@example.com,9222222222,New Road",
  );
  await expect(
    popup.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await expect(popup.getByText("Potential match: Rahul Sharma")).toBeVisible();
  await popup
    .getByRole("button", { name: "Review update to this profile" })
    .click();
  await popup.getByLabel("Resolve phone").selectOption("keep");
  await confirmImport();
  const p = await popup.evaluate(
    async () =>
      (
        await chrome.runtime.sendMessage({
          type: "DB_SEARCH",
          query: "rahul@example.com",
        })
      ).result.items[0],
  );
  expect(p.fields.phone).toBe("9876543210");
  expect(p.fields.address).toBe("Updated Road");
  expect(
    await popup.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result.total,
    ),
  ).toBe(3);
  await upload(
    "updates.csv",
    "Name,Email,Phone,Address\nRahul Sharma,rahul@example.com,1111111111,Updated Road\nNew Person,new@example.com,9222222222,New Road",
  );
  await popup.getByLabel("Record decision").selectOption("skip");
  await popup.getByRole("button", { name: "Next record" }).click();
  await popup.getByLabel("Record decision").selectOption("skip");
  await popup
    .getByLabel(
      "I reviewed the person boundaries, values and duplicate decisions.",
    )
    .check();
  await popup
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(popup.locator("#status")).toContainText("already imported");
});
test("reads a real multi-person PDF, a DOCX, and an Excel spreadsheet locally", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  [
    "Name: Alex Carter",
    "Email: alex@example.com",
    "Phone: 9876543210",
    "Name: Morgan Lee",
    "Email: morgan@example.com",
    "Phone: 9123456789",
  ].forEach((line, i) =>
    page.drawText(line, { x: 40, y: 740 - i * 24, size: 12, font }),
  );
  await upload("two-people.pdf", await pdf.save());
  await expect(popup.getByText(/Record 1 of 2/)).toBeVisible();
  await confirmImport();
  expect(
    await popup.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result.total,
    ),
  ).toBe(2);
  await upload("resume.docx", await readFile("tests/fixtures/resume.docx"));
  await popup.getByLabel("Record decision").selectOption("create");
  await confirmImport();
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("People");
  sheet.addRow(["Name", "Email", "Phone"]);
  sheet.addRow(["Excel Person", "excel@example.com", "9000000000"]);
  await upload("people.xlsx", await book.xlsx.writeBuffer());
  await confirmImport();
  expect(
    await popup.evaluate(
      async () =>
        (
          await chrome.runtime.sendMessage({
            type: "DB_SEARCH",
            query: "excel@example.com",
          })
        ).result.items.length,
    ),
  ).toBe(1);
});
test("preserves existing values, learns trusted page edits only after confirmation, and survives database reopening", async () => {
  await seed();
  await job.locator("#email").fill("existing@example.com");
  await select("Rahul Sharma");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#email")).toHaveValue("existing@example.com");
  await job.locator("#address").fill("Manual Home");
  await job.locator("#email").click();
  await popup
    .getByRole("button", { name: "Review answers entered on page" })
    .click();
  expect(
    await popup.evaluate(
      async () =>
        (
          await chrome.runtime.sendMessage({
            type: "DB_SEARCH",
            query: "Rahul",
          })
        ).result.items[0].fields.address,
    ),
  ).toBeUndefined();
  await popup
    .getByRole("button", { name: "Confirm save to selected profile" })
    .click();
  await expect(popup.locator("#status")).toContainText("saved to Rahul");
  await background.reload();
  await popup.reload();
  await select("Rahul Sharma");
  await job.goto(`${url}/fixture`);
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#address")).toHaveValue("Manual Home");
});
test("manages profiles, imports JSON exports, and protects database from content-script requests", async () => {
  await seed();
  await popup.getByRole("button", { name: "Settings", exact: true }).click();
  await popup.getByRole("button", { name: "Export JSON", exact: true }).click();
  const downloaded = popup.waitForEvent("download");
  await popup
    .getByRole("button", { name: "Confirm export", exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("personal-assist-profiles.json");
  expect(
    JSON.parse(await readFile(await download.path(), "utf8")).profiles,
  ).toHaveLength(2);

  const exported = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_EXPORT" })).result,
  );
  expect(exported.profiles.length).toBe(2);
  expect(
    exported.profiles.every(
      (person) =>
        person.identityKeys === undefined && person.searchTokens === undefined,
    ),
  ).toBe(true);
  await job.addScriptTag({ path: resolve("dist/content.js") });
  expect(
    await job.evaluate(() => chrome.runtime.sendMessage({ type: "DB_EXPORT" })),
  ).toBeUndefined();
  await popup.getByRole("button", { name: "People", exact: true }).click();
  await popup.locator(".person").filter({ hasText: "Rahul Sharma" }).click();
  await popup
    .getByRole("button", { name: "Edit profile", exact: true })
    .click();
  await popup.getByLabel("Full name", { exact: true }).fill("Rahul Updated");
  await popup.getByLabel("Resolve fullName").selectOption("replace");
  await popup
    .getByRole("button", { name: "Save profile", exact: true })
    .click();
  await expect(popup.locator("#status")).toContainText("Profile saved");
  await popup
    .getByRole("button", { name: "Delete profile", exact: true })
    .click();
  await popup
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(popup.locator("#status")).toContainText("completed");
  expect(
    await popup.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result.total,
    ),
  ).toBe(1);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "DB_CLEAR" }));
  await upload("backup.json", JSON.stringify(exported));
  await confirmImport();
  expect(
    await popup.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "DB_STATS" })).result.total,
    ),
  ).toBe(2);
});
test("handles unreadable files, changed forms and permission errors without disclosing data", async () => {
  await popup.getByRole("button", { name: "Import", exact: true }).click();
  await popup.getByLabel("Upload document").setInputFiles({
    name: "blank.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(""),
  });
  await expect(popup.locator("#status")).toContainText("No readable text");
  await seed();
  await select("Rahul Sharma");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await job.evaluate(
    () =>
      (document.querySelector("#name").closest("label").firstChild.textContent =
        "Bank account number"),
  );
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#name")).toHaveValue("");
  await popup.evaluate(() => {
    chrome.scripting.executeScript = async () => {
      throw new Error("Website access denied");
    };
  });
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await expect(popup.locator("#status")).toContainText("access denied");
  expect(await job.evaluate(() => window.submitted)).toBe(false);
});

test("paginates large imports and searches by partial normalized phone and company", async () => {
  const records = [
    "Name,Email,Phone,Company",
    ...Array.from(
      { length: 500 },
      (_, i) =>
        `Person ${i},p${i}@example.com,98${String(i).padStart(8, "0")},${i === 42 ? "Target Company" : "Company " + i}`,
    ),
  ].join("\n");
  await upload("500-people.csv", records);
  await confirmImport();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .first()
    .click();
  await expect(popup.locator(".person")).toHaveCount(20);
  await popup.locator("#search").fill("00042");
  await expect(popup.locator(".person")).toHaveCount(11);
  await expect(popup.getByText("Person 42", { exact: true })).toBeVisible();
  await popup.locator("#search").fill("98 0000 0042");
  await expect(popup.locator(".person")).toHaveCount(1);
  await popup.locator("#search").fill("TARGET company");
  await expect(popup.locator(".person")).toHaveCount(1);
  await popup.getByRole("button", { name: "Clear search" }).click();
  await expect(popup.locator(".person")).toHaveCount(20);
  await popup.getByRole("button", { name: "Next", exact: true }).click();
  await expect(popup.locator(".inline")).toContainText(["21–40 of 500"]);
});

test("re-scans dynamic steps and rejects invalid learned values", async () => {
  await seed();
  await select("Rahul Sharma");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup.getByLabel("Answer Home Address").fill("First step address");
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await popup.getByRole("button", { name: "Use once / discard" }).click();
  await job.evaluate(() => {
    document.querySelector("form").innerHTML =
      '<label>City<input id="city" required></label><label>Email Address<input id="secondEmail" type="email" required></label><button>Submit</button>';
  });
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup.getByLabel("Answer City").fill("Pune");
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#city")).toHaveValue("Pune");
  await popup.getByRole("button", { name: "Use once / discard" }).click();
  await job.locator("#secondEmail").fill("invalid");
  await job.locator("#city").click();
  await popup
    .getByRole("button", { name: "Review answers entered on page" })
    .click();
  await expect(popup.locator("#status")).toContainText("No valid manual edits");
});

test("keeps on-device AI opt-in and degrades gracefully when the browser API is absent", async () => {
  await popup.evaluate(() =>
    Object.defineProperty(globalThis, "LanguageModel", {
      value: undefined,
      writable: true,
      configurable: true,
    }),
  );
  await popup.getByRole("button", { name: "Settings", exact: true }).click();
  await popup
    .getByRole("button", { name: "Prepare / enable on-device AI" })
    .click();
  await expect(popup.locator("#status")).toContainText("does not expose");
  // Provider contract, not model accuracy: a source-supported record still needs review.
  await popup.evaluate(() => {
    globalThis.LanguageModel = {
      create: async () => ({
        prompt: async () =>
          JSON.stringify({
            records: [
              {
                fields: {
                  fullName: { value: "AI Person", quote: "Name: AI Person" },
                  email: {
                    value: "ai@example.com",
                    quote: "Email: ai@example.com",
                  },
                },
              },
            ],
          }),
        destroy: () => {},
      }),
    };
  });
  await popup
    .getByRole("button", { name: "Prepare / enable on-device AI" })
    .click();
  await expect(popup.locator("#status")).toContainText("On-device AI enabled");
  await upload("ai-document.txt", "Name: AI Person\nEmail: ai@example.com");
  await expect(popup.getByLabel("Record decision")).toHaveValue("");
  await expect(
    popup.getByRole("button", { name: "Confirm import", exact: true }),
  ).toBeDisabled();
  await popup.getByLabel("Record decision").selectOption("create");
  await confirmImport();
});

test("migrates a legacy profile once without silently re-enabling old automatic behavior", async () => {
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "DB_CLEAR" }));
  // Clear the version marker to emulate a first upgrade from the previous release.
  await background.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("personal-assist-v2");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("settings", "readwrite");
          tx.objectStore("settings").delete("legacyMigration");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await popup.evaluate(() =>
    chrome.storage.local.set({
      profile: {
        firstName: "Legacy",
        lastName: "Person",
        email: "legacy@example.com",
      },
      savedAnswers: {
        old: {
          label: "Expected salary",
          answer: "50000",
          origin: "https://example.com",
        },
      },
    }),
  );
  await background.reload();
  await popup.reload();
  await expect(popup.locator(".person")).toContainText(["Legacy Person"]);
  await expect(job.locator("#email")).toHaveValue("");
  await background.reload();
  await popup.reload();
  await expect(popup.locator(".person")).toHaveCount(1);
  const exported = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_EXPORT" })).result,
  );
  expect(exported.legacyAnswers.old.answer).toBe("50000");
  expect(exported.profiles[0].status).toBe("review");
});

test("captures current workspace assets from real imported sample state", async () => {
  await popup.setViewportSize({ width: 1280, height: 800 });
  await seed();
  await select("Rahul Sharma");
  await popup.getByRole("button", { name: "People", exact: true }).click();
  await popup.screenshot({ path: "docs/store-assets/profile.png" });
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .first()
    .click();
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup.screenshot({ path: "docs/store-assets/missing-answers.png" });
});

test("retains IndexedDB profiles across a full Chromium shutdown and restart", async () => {
  await seed();
  const before = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_SEARCH", query: "Rahul" }))
        .result.items[0],
  );
  await context.close();
  await setupContext();
  await select("Rahul Sharma");
  const after = await popup.evaluate(
    async () =>
      (await chrome.runtime.sendMessage({ type: "DB_SEARCH", query: "Rahul" }))
        .result.items[0],
  );
  expect(after.id).toBe(before.id);
  expect(after.fields.email).toBe("rahul@example.com");
  await expect(job.locator("#name")).toHaveValue("");
  await popup.getByRole("button", { name: "Scan form", exact: true }).click();
  await popup
    .getByRole("button", { name: "Fill form", exact: true })
    .last()
    .click();
  await expect(job.locator("#phone")).toHaveValue("9876543210");
});

test("imports and saves PDF profiles from the workspace tab with Chrome tab sender metadata", async () => {
  await popup.goto(`${url}/manager.html`);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  ["Name: Workspace Person", "Email: workspace@example.com"].forEach(
    (line, i) =>
      page.drawText(line, { x: 40, y: 740 - i * 24, size: 12, font }),
  );
  await upload("workspace-person.pdf", await pdf.save());
  await confirmImport();
  expect(
    await popup.evaluate(
      async () =>
        (
          await chrome.runtime.sendMessage({
            type: "DB_SEARCH",
            query: "workspace@example.com",
          })
        ).result.items[0].fields.fullName,
    ),
  ).toBe("Workspace Person");
  await popup.reload();
  await popup.getByRole("button", { name: "People", exact: true }).click();
  await expect(popup.locator(".person")).toContainText(["Workspace Person"]);
});
