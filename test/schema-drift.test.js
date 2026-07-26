// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CARD_SCHEMA } from "../src/index.js";

// Copies of the schema that live outside this package. Paths are resolved from
// the monorepo root, so a standalone clone of this repo simply has none of them
// and the checks skip. Drift is caught wherever the sources sit side by side.
const repoRoot = new URL("../../", import.meta.url);

/** @param {string} relative @returns {string | null} */
function readSibling(relative) {
  const absolute = fileURLToPath(new URL(relative, repoRoot));
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

/**
 * Extract the [key, kind] pairs from a JavaScript `CARD_SCHEMA = [...]` literal
 * without executing the file — the console bundle is not a module this package
 * can safely import.
 *
 * @param {string} source
 * @returns {Array<[string, string]>}
 */
function parseSchemaLiteral(source) {
  const start = source.indexOf("CARD_SCHEMA");
  assert.notEqual(start, -1, "CARD_SCHEMA not found in the console bundle");
  const open = source.indexOf("[", start);
  const close = source.indexOf("\n];", open);
  assert.notEqual(close, -1, "CARD_SCHEMA literal is not terminated as expected");
  const body = source.slice(open, close);

  /** @type {Array<[string, string]>} */
  const pairs = [];
  const entry = /\[\s*'([^']+)'\s*,\s*'([^']+)'/g;
  for (const match of body.matchAll(entry)) pairs.push([match[1], match[2]]);
  return pairs;
}

test("the console's CARD_SCHEMA copy has not drifted from this package", (t) => {
  const source = readSibling("webapp/src/data/cards.js");
  if (source === null) {
    t.skip("webapp/src/data/cards.js not present — standalone clone");
    return;
  }

  const consoleFields = parseSchemaLiteral(source);
  const authoritative = CARD_SCHEMA.map(([key, kind]) => [key, kind]);

  assert.deepEqual(
    consoleFields,
    authoritative,
    "webapp/src/data/cards.js disagrees with @bna/validator-core. This package is authoritative " +
      "(TRUST-METHODOLOGY.md §4.4); update the console copy, not this test."
  );
});

test("the methodology still delegates the field list rather than duplicating it", (t) => {
  const source = readSibling("marketing/launch-assets/TRUST-METHODOLOGY.md");
  if (source === null) {
    t.skip("TRUST-METHODOLOGY.md not present — standalone clone");
    return;
  }

  // §4.4 defers to this package instead of restating the fields. That is the
  // property worth protecting: a third copy of the list in prose is what would
  // let the published methodology and the shipped scoring disagree.
  assert.match(
    source,
    /The full check list ships with `bna-validator-core` and is versioned with it\./,
    "TRUST-METHODOLOGY.md §4.4 no longer delegates the check list to this package"
  );

  const declaredInProse = CARD_SCHEMA.filter(([key]) => key.startsWith("x-bna.")).filter((field) =>
    source.includes(`\`${field[0]}\``)
  );
  assert.deepEqual(
    declaredInProse,
    [],
    "TRUST-METHODOLOGY.md has started naming individual schema fields — either remove them or " +
      "extend this test to compare them against CARD_SCHEMA"
  );
});
