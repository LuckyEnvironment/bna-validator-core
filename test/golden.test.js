// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CARD_SCHEMA, SCHEMA_VERSION, validateCard } from "../src/index.js";

const goldenDirectory = new URL("./fixtures/golden/", import.meta.url);
const snapshotPath = fileURLToPath(new URL("./fixtures/golden.snapshot.json", import.meta.url));

/**
 * @typedef {object} GoldenFixture
 * @property {string} description
 * @property {{ verdict: "ok" | "warn" | "err", errors: number, warns: number }} expect
 * @property {{ strict?: boolean }} [options]
 * @property {unknown} card
 */

const fixtures = readdirSync(goldenDirectory)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => ({
    name,
    fixture: /** @type {GoldenFixture} */ (
      JSON.parse(readFileSync(fileURLToPath(new URL(name, goldenDirectory)), "utf8"))
    )
  }));

/**
 * Reduce a report to the shape that must not change silently: the headline
 * verdict plus the level assigned to every field, in schema order.
 *
 * @param {ReturnType<typeof validateCard>} report
 * @returns {Record<string, unknown>}
 */
function summarise(report) {
  return {
    verdict: report.verdict,
    errors: report.errors,
    warns: report.warns,
    fields: Object.fromEntries(report.fields.map((field) => [field.key, `${field.level}: ${field.msg}`]))
  };
}

const actual = {
  schemaVersion: SCHEMA_VERSION,
  fixtures: Object.fromEntries(
    fixtures.map(({ name, fixture }) => [name, summarise(validateCard(fixture.card, fixture.options))])
  )
};

// `UPDATE_GOLDEN=1 npm test` rewrites the snapshot. The resulting diff is the
// artefact a reviewer reads when a scoring change is proposed, so it is meant
// to be committed alongside the change that caused it — never regenerated to
// make a red test go green.
if (process.env.UPDATE_GOLDEN === "1") {
  writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
}

test("golden corpus covers every field kind and both extension forms", () => {
  assert.ok(fixtures.length >= 10, `expected a corpus, found ${fixtures.length} fixtures`);

  const observed = new Set();
  for (const { fixture } of fixtures) {
    const report = validateCard(fixture.card, fixture.options);
    for (const field of report.fields) observed.add(`${field.kind}:${field.level}`);
  }
  for (const expected of ["required:ok", "required:err", "bna:ok", "bna:warn", "bna:err"]) {
    assert.ok(observed.has(expected), `no fixture produces a ${expected} field`);
  }

  const covered = new Set(
    fixtures.flatMap(({ fixture }) =>
      validateCard(fixture.card, fixture.options)
        .fields.filter((field) => field.level === "ok")
        .map((field) => field.key)
    )
  );
  for (const [key] of CARD_SCHEMA) {
    assert.ok(covered.has(key), `no fixture scores ${key} as present`);
  }
});

for (const { name, fixture } of fixtures) {
  test(`golden: ${name} — ${fixture.description.split(".")[0]}`, () => {
    const report = validateCard(fixture.card, fixture.options);
    assert.equal(report.verdict, fixture.expect.verdict);
    assert.equal(report.errors, fixture.expect.errors);
    assert.equal(report.warns, fixture.expect.warns);
    assert.equal(report.errors + report.warns + report.fields.filter((f) => f.level === "ok").length, CARD_SCHEMA.length);
  });
}

test("golden snapshot matches the committed scoring", () => {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  assert.deepEqual(
    actual,
    snapshot,
    "scoring changed — review the golden.snapshot.json diff, then regenerate with UPDATE_GOLDEN=1"
  );
});
