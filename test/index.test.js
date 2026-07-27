// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  A2A_PROTOCOL_VERSIONS,
  CARD_SCHEMA,
  MAX_CARD_BYTES,
  MAX_CARD_DEPTH,
  SCHEMA_METADATA,
  SCHEMA_VERSION,
  validateCard
} from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/valid-card.json", import.meta.url)), "utf8")
);

test("exports versioned schema metadata", () => {
  assert.equal(SCHEMA_VERSION, "0.1");
  assert.deepEqual(A2A_PROTOCOL_VERSIONS, ["1.0"]);
  assert.equal(SCHEMA_METADATA.canonicalExtensionFormat, "flat");
  assert.equal(CARD_SCHEMA.length, 15);
});

test("accepts a complete canonical card", () => {
  const report = validateCard(fixture);
  assert.equal(report.verdict, "ok");
  assert.equal(report.errors, 0);
  assert.equal(report.warns, 0);
  assert.ok(report.fields.every((field) => field.level === "ok"));
});

test("preserves zero and false values while rejecting blank strings", () => {
  const card = { ...fixture, "x-bna.zdr": false, "x-bna.residency": "   " };
  const report = validateCard(card);
  assert.equal(report.fields.find((field) => field.key === "x-bna.zdr")?.level, "ok");
  assert.equal(report.fields.find((field) => field.key === "x-bna.residency")?.level, "warn");
});

test("accepts nested BNA extensions as a style warning", () => {
  const card = { ...fixture };
  for (const [key] of CARD_SCHEMA.filter(([key]) => key.startsWith("x-bna."))) {
    card[key] = undefined;
  }
  card["x-bna"] = {
    residency: "eu-west-1",
    zdr: false,
    compliance: ["SOC 2"],
    pricing: { currency: "EUR" },
    contact: "ops@example.invalid"
  };
  const report = validateCard(card);
  assert.equal(report.errors, 0);
  assert.equal(report.warns, 5);
  assert.match(report.fields.at(-1)?.msg ?? "", /canonical flat key/);
});

test("enforces required field values and strict optional fields", () => {
  const absent = validateCard({ ...fixture, name: "", "x-bna.contact": undefined });
  assert.equal(absent.errors, 1);
  assert.equal(absent.warns, 1);
  const strict = validateCard({ ...fixture, "x-bna.contact": undefined }, { strict: true });
  assert.equal(strict.errors, 1);
});

test("reports type mismatches", () => {
  const report = validateCard({
    ...fixture,
    protocolVersion: "9.9",
    url: "not-a-url",
    defaultInputModes: ["", 7],
    "x-bna.zdr": "false"
  });
  assert.equal(report.errors, 3);
  assert.equal(report.warns, 1);
});

test("does not throw for malformed, unsafe, deep, circular, or oversized cards", () => {
  for (const value of [null, undefined, [], "", "x", 7, { __proto__: { polluted: true } }]) {
    assert.doesNotThrow(() => validateCard(value));
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);

  /** @type {Record<string, unknown>} */
  let deep = {};
  let cursor = deep;
  for (let index = 0; index <= MAX_CARD_DEPTH; index += 1) {
    cursor.next = {};
    cursor = /** @type {Record<string, unknown>} */ (cursor.next);
  }
  assert.match(validateCard(deep).fields[0].msg, /depth limit/);

  const circular = {};
  circular.self = circular;
  assert.match(validateCard(circular).fields[0].msg, /circular/);

  const oversized = { ...fixture, description: "x".repeat(MAX_CARD_BYTES + 1) };
  assert.match(validateCard(oversized).fields[0].msg, /size limit/);
});

test("measures card size in UTF-8 bytes without depending on Node globals", () => {
  // The console imports this module directly, so `Buffer` is not in scope
  // there. The size limit still has to be counted in real UTF-8 bytes, and
  // has to agree with Buffer.byteLength exactly — a card that is oversized
  // in the CLI must be oversized in the browser, or the two disagree about
  // whether a third party's card is admissible at all.
  const samples = [
    "",
    "ascii",
    "é",
    "中",
    "\u{1F600}",
    "\u{1F469}‍\u{1F469}‍\u{1F467}‍\u{1F466}",
    "\uD83D", // lone high surrogate
    "\uDC00", // lone low surrogate
    "a\uD83Db",
    "München \u{1F916}"
  ];

  // A one-key card costs the key plus the value, so the budget is exact and
  // the boundary can be asserted to the byte rather than approximately.
  const keyBytes = "description".length;
  const overLimit = /size limit/;

  for (const sample of samples) {
    const sampleBytes = Buffer.byteLength(sample, "utf8");
    const fill = MAX_CARD_BYTES - keyBytes - sampleBytes;
    const atLimit = validateCard({ description: "x".repeat(fill) + sample });
    const overBy1 = validateCard({ description: "x".repeat(fill + 1) + sample });

    assert.ok(
      !overLimit.test(atLimit.fields[0].msg),
      `${JSON.stringify(sample)} (${sampleBytes} B): a card of exactly MAX_CARD_BYTES was rejected — ` +
        `the counter is over-counting. Got: ${atLimit.fields[0].msg}`
    );
    assert.match(
      overBy1.fields[0].msg,
      overLimit,
      `${JSON.stringify(sample)} (${sampleBytes} B): one byte past MAX_CARD_BYTES was accepted — ` +
        "the counter is under-counting."
    );
  }

  // Counting UTF-16 code units instead of UTF-8 bytes would halve the
  // measured size of this card and let it through.
  const astral = "\u{1F600}".repeat(3_000_000); // 12 MB as UTF-8, 6 M code units
  assert.match(
    validateCard({ description: astral }).fields[0].msg,
    overLimit,
    "an astral-plane card over the byte limit was admitted — size is being counted in UTF-16 units"
  );

  // The module must not reach for a Node-only global at all. Comments are
  // stripped first so that documenting the constraint does not violate it.
  const code = readFileSync(fileURLToPath(new URL("../src/index.js", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const nodeGlobal of ["Buffer", "process", "require", "__dirname", "global"]) {
    assert.ok(
      !new RegExp(`\\b${nodeGlobal}\\b`).test(code),
      `src/index.js uses the Node-only global ${nodeGlobal}; the console imports this file and cannot provide it`
    );
  }
});

test("handles Unicode and homoglyphs without normalising them", () => {
  const report = validateCard({ ...fixture, name: "Аgent \u{1F916}", provider: { name: "München" } });
  assert.equal(report.verdict, "ok");
});

test("fixture remains valid JSON", () => {
  const raw = readFileSync(fileURLToPath(new URL("./fixtures/valid-card.json", import.meta.url)), "utf8");
  assert.deepEqual(JSON.parse(raw), fixture);
});
