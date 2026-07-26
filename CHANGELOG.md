# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
