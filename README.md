# @bna/validator-core

Versioned, dependency-free validation for BNA A2A agent cards.

```js
import { validateCard } from "@bna/validator-core";

const result = validateCard(card);
```

`validateCard` returns `{ verdict, errors, warns, fields }`. The authoritative
schema is exported as `CARD_SCHEMA`; `SCHEMA_VERSION` is methodology version
`0.1` and targets A2A protocol `1.0`.

Canonical BNA extensions use flat names such as `x-bna.residency`. The
validator accepts the legacy nested form (`x-bna: { residency: "…" }`) and
emits a non-blocking style warning rather than treating it as absent. Blank
strings are absent; `0` and `false` are present.

This module validates document structure and declared types locally. It does
not resolve endpoints or make network observations.

## Compatibility and releases

A field promotion from optional BNA context to a required field is a major
schema change. It receives at least 30 days' notice and migration guidance;
see [CONTRIBUTING.md](./CONTRIBUTING.md).

Licensed under [Apache-2.0](./LICENSE).
