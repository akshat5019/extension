import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { portalPattern } from "../src/portal.js";

test("portal permission is scoped to one protocol and hostname", () => {
  assert.equal(
    portalPattern("https://www.naukri.com/application?id=1"),
    "https://www.naukri.com/*",
  );
  assert.equal(
    portalPattern("http://127.0.0.1:3000/apply"),
    "http://127.0.0.1/*",
  );
  assert.throws(() => portalPattern("chrome://extensions"));
});
