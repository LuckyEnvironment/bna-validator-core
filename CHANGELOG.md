# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — M2, probe keys

- **`x-bna.probe-key`**, a public JWK a vendor publishes so BNA's probes of them
  can be countersigned. Accepts Ed25519 (OKP) and RSA, and validates the
  structure rather than the presence: a malformed key is a type error on the
  existing wrong-type path, because a broken key advertises an attestation path
  that cannot work and the vendor has no way to discover that from their side.
  Any JWK carrying a private component is refused outright.

- **A third field kind, `informational`, and a fourth level, `info`.** An
  undeclared probe key reports as `info`: counted in neither `errors` nor
  `warns`, and unable to move a verdict. A fully conformant card that publishes
  no probe key still scores `ok`.

  This exists because of one specific field. `x-bna.probe-key` enables a vendor
  to hold BNA accountable, and if not publishing one cost them a verdict, an
  accountability mechanism would have become leverage over the people being
  rated. `strict` still escalates it, because strict is a deliberate request to
  treat every undeclared field as blocking.

  The alternative — making it a `bna` field — was measured before being
  rejected: it moved four of the twelve golden cards from `ok` to `warn`,
  which is to say every card that was previously perfect.

- Golden fixtures 13 and 14 covering a valid and a malformed probe key. The
  snapshot diff for the existing twelve is additive: one `info` row each, and
  no change to any existing field's level. The single scoring change is the
  strict fixture's error count, 5 to 6.

### Changed

- **The package no longer depends on Node globals.** Card size was measured with
  `Buffer.byteLength`, which does not exist in a browser, so the module could
  not be imported by the console or the developer portal. It now counts UTF-8
  bytes directly, without allocating — lone surrogates count as 3 bytes, which
  is what both `Buffer.byteLength` and `TextEncoder` produce after U+FFFD
  substitution, so the limit is enforced identically wherever it runs.

  This is what lets the documentation portal import this file straight from the
  repository and score a card in the reader's browser using the same bytes the
  CLI counts, rather than a copy that can drift.

### Added

- **Golden fixture corpus** — 12 anonymised cards in `test/fixtures/golden/`,
  each with a hand-authored expected verdict, plus a committed
  `golden.snapshot.json` recording the level assigned to every field. A change
  in scoring now shows up as a reviewable diff rather than a silent behaviour
  change. Regenerate deliberately with `UPDATE_GOLDEN=1 npm test`.
- **Schema drift test** (`test/schema-drift.test.js`) — fails if the console's
  copy of `CARD_SCHEMA` in `webapp/src/data/cards.js` diverges from this
  package in key, kind, or order, and fails if `TRUST-METHODOLOGY.md` stops
  delegating the field list and starts restating it. Skips cleanly in a
  standalone clone where the sibling files are absent.
- **Package smoke test** (`test/package.test.js`) — packs the tarball, installs
  it into a scratch project, exercises it at runtime, and type-checks a
  consumer against the emitted `.d.ts`. Includes a negative control asserting
  that a deliberate type error is *rejected*, so the test cannot pass while the
  declarations are missing or silently `any`.

### Note on the methodology

The build brief states that `CARD_SCHEMA` exists in three places, the third
being prose in `TRUST-METHODOLOGY.md`. It does not: §4.4 says "the full check
list ships with `bna-validator-core` and is versioned with it", which is
already the correct arrangement. The drift test guards the two real copies and
asserts that the methodology's delegation is not quietly replaced by a third
list.
