import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { build } from "esbuild";
await build({
  entryPoints: {
    repository: "src/core/repository.ts",
    model: "src/core/model.ts",
    extraction: "src/core/extraction.ts",
    mapping: "src/core/mapping.ts",
    ai: "src/core/ai.ts",
    access: "src/core/access.ts",
    pdfLayout: "src/core/pdf-layout.ts",
  },
  outdir: ".test-core",
  bundle: true,
  format: "esm",
  platform: "node",
});
const { LocalRepository } = await import("../.test-core/repository.js");
const { extractCSV, extractPeople } =
  await import("../.test-core/extraction.js");
const { combine, completeNameFields, tokens } =
  await import("../.test-core/model.js");
const { mapper } = await import("../.test-core/mapping.js");
const { validateModelRecords } = await import("../.test-core/ai.js");
const { readPdfPage } = await import("../.test-core/pdfLayout.js");
let repository;
test.beforeEach(() => {
  repository = new LocalRepository(`test-${crypto.randomUUID()}`);
});
test.afterEach(async () => {
  await repository.delete();
});
test("separates CSV rows and labelled people without pooling identifiers", () => {
  const csv = extractCSV(
    "Name,Email,Phone,Address\nRahul Sharma,rahul@example.com,9876543210,12 Lake Road\nPriya Sharma,priya@example.com,9123456789,20 Park Street",
  );
  assert.equal(csv.candidates.length, 2);
  assert.equal(csv.candidates[1].fields.email, "priya@example.com");
  const people = extractPeople(
    "Name: Rahul Sharma\nEmail: rahul@example.com\nPhone: 9876543210\nName: Priya Sharma\nEmail: priya@example.com\nPhone: 9123456789",
  );
  assert.equal(people.candidates.length, 2);
  assert.equal(people.candidates[0].fields.phone, "9876543210");
  assert.equal(people.candidates[1].fields.email, "priya@example.com");
  assert.equal(people.candidates[0].fields.firstName, "Rahul");
  assert.equal(people.candidates[0].fields.lastName, "Sharma");
  assert.equal(people.candidates[1].fields.firstName, "Priya");
  assert.throws(
    () =>
      extractPeople(
        "Rahul Sharma\nPriya Gupta\nrahul@example.com\npriya@example.com",
      ),
    /No safely separable/,
  );
});
test("structured imports exclude authentication and banking fields", () => {
  const { candidates, warnings } = extractCSV(
    "Name,Password,Bank Account Number,Email\nRahul Sharma,secret,123456,rahul@example.com",
  );
  assert.deepEqual(Object.keys(candidates[0].fields), [
    "fullName",
    "email",
    "firstName",
    "lastName",
  ]);
  assert.equal(warnings.length, 2);
});
test("prepares resume name parts without retyping and preserves explicit names", () => {
  const candidate = extractPeople(
    "Akshat Kumar Sharma\nSoftware Engineer\nakshat@example.com\n9876543210\nEducation\nNational Technical Institute\nProjects\nJob Application Assistant",
  ).candidates[0];
  assert.equal(candidate.fields.fullName, "Akshat Kumar Sharma");
  assert.equal(candidate.fields.firstName, "Akshat");
  assert.equal(candidate.fields.middleName, "Kumar");
  assert.equal(candidate.fields.lastName, "Sharma");
  const explicit = completeNameFields({
    fullName: "Mary Ann de la Cruz",
    firstName: "Mary Ann",
    lastName: "de la Cruz",
  });
  assert.equal(explicit.firstName, "Mary Ann");
  assert.equal(explicit.lastName, "de la Cruz");
  assert.equal(explicit.middleName, undefined);
  assert.equal(
    completeNameFields({ firstName: "Akshat", lastName: "Sharma" }).fullName,
    "Akshat Sharma",
  );
  assert.equal(completeNameFields({ fullName: "Prince" }).firstName, "Prince");
  assert.equal(completeNameFields({ fullName: "Prince" }).lastName, undefined);
  assert.equal(
    completeNameFields({ fullName: "Rahul Sharma", firstName: "Priya" })
      .lastName,
    undefined,
  );
  assert.equal(
    completeNameFields({ fullName: ["Rahul Sharma", "Priya Gupta"] }).firstName,
    undefined,
  );
  assert.equal(
    completeNameFields({ fullName: "Rahul Sharma / Priya Gupta" }).firstName,
    undefined,
  );
  const ambiguous = extractPeople(
    "Rahul Sharma\nPriya Gupta\nrahul@example.com\nEducation\nNational Technical Institute",
  ).candidates[0];
  assert.equal(ambiguous.fields.fullName, undefined);
  assert.equal(ambiguous.fields.firstName, undefined);
});
test("fills name fields for existing full-name-only profiles without database changes", () => {
  const old = { fullName: "Akshat Kumar Sharma", email: "akshat@example.com" };
  for (const [label, key, value] of [
    ["Name (required)", "fullName", "Akshat Kumar Sharma"],
    ["Legal First Name", "firstName", "Akshat"],
    ["Middle name", "middleName", "Kumar"],
    ["Family Name", "lastName", "Sharma"],
  ]) {
    assert.equal(mapper.key(label), key);
    assert.equal(mapper.value(old, { label, key }), value);
  }
  assert.equal(mapper.key("Middle", "additional-name"), "middleName");
  assert.equal(old.firstName, undefined);
  assert.equal(
    mapper.value(
      { fullName: ["Rahul Sharma", "Priya Gupta"] },
      { key: "firstName", label: "First name" },
    ),
    "",
  );
  assert.equal(
    mapper.value(
      {
        fullName: "Mary Ann de la Cruz",
        firstName: "Mary Ann",
        lastName: "de la Cruz",
      },
      { key: "lastName", label: "Last name" },
    ),
    "de la Cruz",
  );
});
test("extracts resume names, email, city and country from common inline and labelled layouts", () => {
  const layouts = [
    "Akshat Kumar Sharma | Data Analyst\nakshat@example.com • +91 9876543210 • Pune, Maharashtra, India\nSkills\nSQL Excel",
    "Akshat Kumar Sharma, akshat@example.com, Pune, Maharashtra, India\nData Analyst\nEducation\nNational Institute, London, UK",
    "Full Name\nAkshat Kumar Sharma\nMail\nakshat@example.com\nCurrent Location\nPune, Maharashtra, India\nSkills\nSQL Excel",
    "Full Name\n\nAkshat Kumar Sharma\n\nMail\n\nakshat@example.com\n\nCurrent Location\n\nPune, Maharashtra, India\n\nSkills\nSQL Excel",
    "Name: Akshat Kumar Sharma Email: akshat@example.com Location: Pune, Maharashtra, India\nSkills\nSQL Excel",
    "akshat@example.com\nAkshat Kumar Sharma\nPune, Maharashtra, India\nData Analyst\nSkills\nSQL Excel",
  ];
  for (const text of layouts) {
    const fields = extractPeople(text).candidates[0].fields;
    assert.equal(fields.fullName, "Akshat Kumar Sharma", text);
    assert.equal(fields.firstName, "Akshat", text);
    assert.equal(fields.middleName, "Kumar", text);
    assert.equal(fields.lastName, "Sharma", text);
    assert.equal(fields.email, "akshat@example.com", text);
    assert.equal(fields.city, "Pune", text);
    assert.equal(fields.state, "Maharashtra", text);
    assert.equal(fields.country, "India", text);
  }
  const international = extractPeople(
    "Jane O’Neill | Engineer\njane@example.com | London, UK\nExperience\nAcme Company, Paris, France",
  ).candidates[0].fields;
  assert.equal(international.firstName, "Jane");
  assert.equal(international.lastName, "O’Neill");
  assert.equal(international.city, "London");
  assert.equal(international.country, "United Kingdom");
  const table = extractCSV(
    'First name,Family name,Mail,Location\nPriya,Sharma,priya@example.com,"Seattle, USA"',
  ).candidates[0].fields;
  assert.equal(table.fullName, "Priya Sharma");
  assert.equal(table.city, "Seattle");
  assert.equal(table.country, "United States");
});
test("withholds uncertain home locations and never guesses a country from contact details", () => {
  for (const text of [
    "Akshat Sharma\nData Analyst\nakshat@example.com\n+91 9876543210\nExperience\nLondon, UK\nEducation\nParis, France",
    "Akshat Sharma\nData Analyst\nakshat@example.com\nExperience\nLocation: London, UK\nEducation\nParis, France",
    "Akshat Sharma\nData Analyst\nakshat@example.com\nWork History\nLocation: London, UK\nEducation\nParis, France",
    "Akshat Sharma\nData Analyst\nakshat@example.com\nPune, India\nLondon, UK\nSkills\nSQL Excel",
    "Name: Akshat Sharma\nData Analyst\nakshat@example.com\npriya@example.com\nPune, India\nSkills\nSQL Excel",
    "Akshat Sharma\nData Analyst\nakshat@example.com\nRemote, India\nSkills\nSQL Excel",
  ]) {
    const candidate = extractPeople(text).candidates[0];
    assert.equal(candidate.fields.city, undefined, text);
    assert.equal(candidate.fields.country, undefined, text);
  }
  const explicit = extractPeople(
    "Name: Jane Doe\nMail: jane@example.com\nCity: Pune\nLocation: London, UK",
  ).candidates[0];
  assert.equal(explicit.fields.city, "Pune");
  assert.equal(explicit.fields.country, undefined);
  assert.match(explicit.warnings.join(" "), /Conflicting city/);
  const missing = extractPeople(
    "Name: Jane Doe\nMail: jane@example.com\nLocation: Pune, Maharashtra",
  ).candidates[0].fields;
  assert.equal(missing.city, "Pune");
  assert.equal(missing.state, "Maharashtra");
  assert.equal(missing.country, undefined);
});
test("contact normalization preserves explicit person boundaries and page-scoped names", () => {
  for (const separator of ["---", "\f", "==="]) {
    const result = extractPeople(
      `Name\nRahul Sharma\nMail\nrahul@example.com\nLocation\nPune, India\n${separator}\nName\nPriya Gupta\nMail\npriya@example.com\nLocation\nLondon, UK`,
    );
    assert.equal(result.candidates.length, 2);
    assert.equal(result.candidates[0].fields.fullName, "Rahul Sharma");
    assert.equal(result.candidates[0].fields.city, "Pune");
    assert.equal(result.candidates[1].fields.fullName, "Priya Gupta");
    assert.equal(result.candidates[1].fields.city, "London");
    assert.equal(result.candidates[1].fields.email, "priya@example.com");
  }
});
test("recognizes analyst resumes and single-word headings without mistaking section titles for names", () => {
  for (const name of ["AKSHAT", "AKSHAT SHARMA"]) {
    const candidate = extractPeople(
      `Resume\n${name}\nData Analyst\nPower BI Analyst\nPortfolio\nLinkedIn\nGitHub\nakshat@example.com\n+91 9876543210\nProfessional Summary\nEducation\nTechnical Skills\nExcel SQL\nProjects\nSales Dashboard`,
    ).candidates[0];
    assert.equal(candidate.fields.fullName, name);
    assert.equal(candidate.fields.firstName, "AKSHAT");
    assert.equal(
      candidate.fields.lastName,
      name.includes(" ") ? "SHARMA" : undefined,
    );
  }
  const unresolved = extractPeople(
    "Rahul Sharma\nPriya Gupta\nrahul@example.com\nSkills\nSQL Excel",
    [["Rahul Sharma", "Priya Gupta"]],
  ).candidates[0];
  assert.equal(unresolved.fields.fullName, undefined);
  assert.deepEqual(unresolved.nameSuggestions, [
    "Rahul Sharma",
    "Priya Gupta",
    "SQL Excel",
  ]);
  assert.throws(
    () =>
      extractPeople(
        "Rahul Sharma\nPriya Gupta\nrahul@example.com\npriya@example.com\nSkills\nSQL Excel",
        [["Rahul Sharma"]],
      ),
    /No safely separable/,
  );
});
test("PDF geometry restores header order, rejoins split glyphs and separates wide columns", () => {
  const item = (str, x, y, size, width) => ({
    str,
    transform: [size, 0, 0, size, x, y],
    height: size,
    width,
  });
  const result = readPdfPage([
    item("Excel SQL", 40, 500, 12, 55),
    item("akshat@example.com", 40, 680, 12, 140),
    item("Sales Dashboard", 40, 470, 12, 90),
    item("Data Analyst", 40, 710, 14, 90),
    item("AKSHAT", 40, 760, 28, 120),
    item("SHARMA", 168, 760, 28, 125),
    item("Education", 320, 640, 12, 60),
    item("Skills", 40, 640, 12, 40),
  ]);
  assert.equal(result.text.split("\n")[0], "AKSHAT SHARMA");
  assert.match(result.text, /Skills\nEducation/);
  assert.deepEqual(result.nameHints, ["AKSHAT SHARMA"]);
  const extracted = extractPeople(result.text, [result.nameHints])
    .candidates[0];
  assert.equal(extracted.fields.fullName, "AKSHAT SHARMA");
  const fragments = readPdfPage([
    item("AK", 40, 760, 28, 32),
    item("SHAT", 72, 760, 28, 70),
    item("Skills", 40, 640, 12, 40),
    item("Email", 40, 620, 12, 30),
  ]);
  assert.equal(fragments.text.split("\n")[0], "AKSHAT");
  assert.deepEqual(fragments.nameHints, ["AKSHAT"]);
  const explicitSpace = readPdfPage([
    item("Akshat ", 40, 760, 28, 110),
    item("Sharma", 150, 760, 28, 95),
  ]);
  assert.equal(explicitSpace.text, "Akshat Sharma");
  const inlineContact = readPdfPage([
    item("Akshat Sharma", 40, 760, 26, 180),
    item("akshat@example.com", 280, 760, 10, 130),
    item("Data Analyst", 40, 725, 14, 90),
    item("Education", 40, 600, 12, 65),
  ]);
  assert.match(inlineContact.text, /^Akshat Sharma\nakshat@example.com/);
  assert.deepEqual(inlineContact.nameHints, ["Akshat Sharma"]);
  const pages = extractPeople(
    "Akshat Sharma\nPriya Gupta\nakshat@example.com\nSkills\nSQL Excel\n\f\nPriya Gupta\npriya@example.com\nSkills\nSQL Excel",
    [[], ["Priya Gupta"]],
  );
  assert.equal(pages.candidates[0].fields.fullName, undefined);
  assert.equal(pages.candidates[0].fields.email, "akshat@example.com");
  assert.equal(pages.candidates[1].fields.fullName, "Priya Gupta");
});
test("indexed partial search is paged across thousands of persisted people", async () => {
  const records = Array.from({ length: 1500 }, (_, i) => ({
    fields: {
      fullName: `Person ${i}`,
      email: `person${i}@example.com`,
      phone: `+91 98765 ${String(i).padStart(5, "0")}`,
    },
    action: "create",
  }));
  await repository.commitImport("large", "people.csv", records, []);
  assert.equal((await repository.stats()).total, 1500);
  let reads = 0;
  repository.profiles.hook("reading", (person) => {
    reads++;
    return person;
  });
  const first = await repository.search("PERSON", 0, 20);
  assert.ok(
    reads <= 1500,
    `Broad search read ${reads} profiles; count and page must share one pass.`,
  );
  const second = await repository.search("person", 20, 20);
  assert.equal(first.total, 1500);
  assert.equal(first.items.length, 20);
  assert.notEqual(first.items[0].id, second.items[0].id);
  reads = 0;
  assert.equal(
    (await repository.search("person1423@")).items[0].fields.fullName,
    "Person 1423",
  );
  assert.ok(
    reads < 50,
    `Selective search decoded ${reads} profiles despite a common prefix.`,
  );
  assert.equal(
    (await repository.search("98765 01423")).items[0].fields.fullName,
    "Person 1423",
  );
  repository.close();
  const reopened = new LocalRepository(repository.name);
  assert.equal((await reopened.stats()).total, 1500);
  reopened.close();
});
test("upgrades existing profiles to direct identity indexes without losing data", async () => {
  const old = new Dexie(repository.name);
  old.version(1).stores({
    profiles: "id,updatedAt,status,*searchTokens",
    documents: "id,&fingerprint,importedAt",
    settings: "key",
  });
  const fields = {
    fullName: "Legacy Person",
    email: "old@example.com",
    phone: "+91 9876543210",
  };
  const person = {
    id: "existing-id",
    fields,
    schemaVersion: 1,
    revision: 7,
    status: "review",
    sources: [{ name: "Old resume", at: "2026-01-01", fields: ["email"] }],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    searchTokens: tokens(fields),
  };
  await old.table("profiles").put(person);
  await old.table("documents").put({
    id: "old-document",
    name: "resume.pdf",
    fingerprint: "old-fingerprint",
    importedAt: "2026-01-01",
    count: 1,
    warnings: [],
  });
  await old.table("settings").put({ key: "kept-setting", value: true });
  old.close();
  await repository.open();
  const upgraded = await repository.get(person.id);
  assert.deepEqual(
    { ...upgraded, identityKeys: undefined },
    { ...person, identityKeys: undefined },
  );
  assert.ok(upgraded.identityKeys.includes("email:old@example.com"));
  assert.equal(
    (await repository.matches({ phone: "9876543210" }))[0].person.id,
    person.id,
  );
  assert.equal(
    (await repository.documents.get("old-document")).fingerprint,
    "old-fingerprint",
  );
  assert.equal(await repository.getSetting("kept-setting"), true);
  repository.close();
  await repository.open();
  assert.equal((await repository.get(person.id)).revision, 7);
});
test("batch duplicate checks reuse bounded lookups and never reuse stale profile data", async () => {
  const p = await repository.save({
    firstName: "Priya",
    lastName: "Sharma",
    email: "priya@example.com",
    phone: "+91 9876543210",
    alternateEmails: ["alternate@example.com"],
  });
  let reads = 0;
  repository.profiles.hook("reading", (person) => {
    reads++;
    return person;
  });
  const records = Array.from({ length: 100 }, () => ({
    fullName: "Priya Sharma",
    email: "alternate@example.com",
    phone: "9876543210",
  }));
  const result = await repository.analyze(records);
  assert.equal(result.length, 100);
  assert.ok(
    result.every((matches) =>
      matches.some(
        (match) =>
          match.person.id === p.id &&
          match.reasons.includes("same email") &&
          match.reasons.includes("same phone"),
      ),
    ),
  );
  assert.ok(reads <= 8, `Repeated identity lookups read ${reads} profiles.`);
  const changed = await repository.save(
    { ...p.fields, email: "changed@example.com" },
    { id: p.id, revision: p.revision },
  );
  assert.equal(
    (await repository.analyze(records))[0][0].person.fields.email,
    "changed@example.com",
  );
  assert.equal(
    (await repository.matches({ firstName: "Priya", lastName: "Sharma" }))[0]
      .person.revision,
    changed.revision,
  );
  await repository.remove(p.id);
  assert.ok(
    (await repository.analyze(records)).every((matches) => !matches.length),
  );
  await assert.rejects(
    repository.analyze(Array(10001).fill({})),
    /Invalid import batch/,
  );
});
test("direct identifiers find strong matches beyond the bounded similar-name results", async () => {
  await repository.commitImport(
    "same-names",
    "names.csv",
    Array.from({ length: 61 }, (_, i) => ({
      action: "create",
      fields: { fullName: "Same Name", email: `person${i}@example.com` },
    })),
    [],
  );
  // Index duplicates sort by primary key. Choose the last profile so it is
  // definitely outside the first 50 name hints, regardless of random UUIDs.
  const last = await repository.profiles.orderBy("id").last();
  const target = await repository.save(
    {
      ...last.fields,
      email: "strong@example.com",
    },
    { id: last.id, revision: last.revision },
  );
  const matches = await repository.matches({
    fullName: "Same Name",
    email: "strong@example.com",
  });
  assert.ok(
    matches.some(
      (match) =>
        match.person.id === target.id && match.reasons.includes("same email"),
    ),
  );
  assert.equal((await repository.stats()).total, 61);
});
test("names are potential matches, never automatic merge identities", async () => {
  const a = await repository.save({
    fullName: "Rahul Sharma",
    email: "one@example.com",
  });
  const b = await repository.save({
    fullName: "Rahul Sharma",
    email: "two@example.com",
  });
  const matches = await repository.matches({
    fullName: "Rahul Sharma",
    email: "three@example.com",
  });
  assert.equal(matches.length, 2);
  assert.equal((await repository.stats()).total, 2);
  await assert.rejects(
    repository.merge(a.id, b.id, a.revision, b.revision, {}),
    /Choose/,
  );
  const merged = await repository.merge(a.id, b.id, a.revision, b.revision, {
    email: "both",
  });
  assert.deepEqual(merged.fields.email, ["one@example.com", "two@example.com"]);
  assert.equal((await repository.stats()).total, 1);
});
test("import commits atomically, rejects repeated documents and stale revisions", async () => {
  const p = await repository.save({
    fullName: "Priya",
    email: "old@example.com",
  });
  await assert.rejects(
    repository.commitImport(
      "bad",
      "doc.csv",
      [
        { fields: { fullName: "New" }, action: "create" },
        {
          fields: { email: "new@example.com" },
          action: "update",
          targetId: p.id,
          revision: p.revision,
          choices: {},
        },
      ],
      [],
    ),
    /Choose/,
  );
  assert.equal((await repository.stats()).total, 1);
  await repository.commitImport(
    "good",
    "doc.csv",
    [
      {
        fields: { email: "new@example.com" },
        action: "update",
        targetId: p.id,
        revision: p.revision,
        choices: { email: "replace" },
      },
    ],
    [],
  );
  await assert.rejects(
    repository.commitImport("good", "doc.csv", [], []),
    /already imported/,
  );
  await assert.rejects(
    repository.save(p.fields, { id: p.id, revision: p.revision }),
    /changed/,
  );
  assert.equal((await repository.get(p.id)).fields.email, "new@example.com");
});
test("conflict decisions and mapping avoid arbitrary or sensitive fields", () => {
  assert.equal(
    combine({ email: "old" }, { email: "new" }, { email: "keep" }).email,
    "old",
  );
  assert.equal(mapper.key("Bank account number"), null);
  assert.equal(mapper.key("Home address"), "address");
  assert.equal(
    mapper.value(
      { dateOfBirth: "1995-05-01" },
      { key: "dateOfBirth", label: "Date of birth" },
    ),
    "",
  );
  assert.equal(
    mapper.value({ phone: ["111", "222"] }, { key: "phone", label: "Phone" }),
    "",
  );
  assert.equal(
    mapper.value(
      { "custom:favorite color": "blue" },
      { key: "custom:favorite color", label: "Favorite color" },
    ),
    "blue",
  );
});

test("AI output needs source-supported quotes, excludes secrets and always requires identity review", () => {
  const output = JSON.stringify({
    records: [
      {
        fields: {
          fullName: { value: "Rahul Sharma", quote: "Name: Rahul Sharma" },
          email: {
            value: "fake@example.com",
            quote: "Email: fake@example.com",
          },
          password: { value: "secret", quote: "Password: secret" },
        },
      },
    ],
  });
  const result = validateModelRecords(
    output,
    "Name: Rahul Sharma\nEmail: real@example.com\nPassword: secret",
  );
  assert.equal(result.candidates[0].fields.fullName, "Rahul Sharma");
  assert.equal(result.candidates[0].fields.email, undefined);
  assert.equal(result.candidates[0].fields.password, undefined);
  assert.match(result.candidates[0].warnings[0], /Verify/);
});

test("free-form sensitive identifiers cannot be repurposed as phone numbers", () => {
  const result = extractPeople(
    "Name: Rahul Sharma\nPassport: 123456789012\nBank account number: 999999999999",
  );
  assert.equal(result.candidates[0].fields.phone, undefined);
  assert.equal(result.candidates[0].fields.fullName, "Rahul Sharma");
  assert.ok(result.candidates[0].warnings.length);
});

test("database access accepts extension workspace tabs and rejects webpages, other extensions and subframes", async () => {
  const { isTrustedUI } = await import("../.test-core/access.js");
  const root = "chrome-extension://our-extension/";
  const own = {
    id: "our-extension",
    url: root + "manager.html",
    tab: { id: 2 },
    frameId: 0,
  };
  assert.equal(isTrustedUI(own, "our-extension", root), true);
  assert.equal(
    isTrustedUI(
      { ...own, url: root + "popup.html", tab: undefined },
      "our-extension",
      root,
    ),
    true,
  );
  for (const sender of [
    { ...own, url: "https://example.com/form" },
    { ...own, url: "https://example.com/form", tab: undefined },
    { ...own, url: "chrome-extension://another-extension/manager.html" },
    { ...own, id: "another-extension" },
    { ...own, url: root + "background.js" },
    { ...own, frameId: 1 },
    { ...own, url: "not-a-url" },
    { ...own, url: undefined },
  ])
    assert.equal(isTrustedUI(sender, "our-extension", root), false);
});
