import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { build } from "esbuild";
await build({
  entryPoints: {
    repository: "src/core/repository.ts",
    model: "src/core/model.ts",
    extraction: "src/core/extraction.ts",
    mapping: "src/core/mapping.ts",
    ai: "src/core/ai.ts",
  },
  outdir: ".test-core",
  bundle: true,
  format: "esm",
  platform: "node",
});
const { LocalRepository } = await import("../.test-core/repository.js");
const { extractCSV, extractPeople } =
  await import("../.test-core/extraction.js");
const { combine } = await import("../.test-core/model.js");
const { mapper } = await import("../.test-core/mapping.js");
const { validateModelRecords } = await import("../.test-core/ai.js");
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
  assert.deepEqual(Object.keys(candidates[0].fields), ["fullName", "email"]);
  assert.equal(warnings.length, 2);
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
  const first = await repository.search("PERSON", 0, 20),
    second = await repository.search("person", 20, 20);
  assert.equal(first.total, 1500);
  assert.equal(first.items.length, 20);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(
    (await repository.search("person1423@")).items[0].fields.fullName,
    "Person 1423",
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
