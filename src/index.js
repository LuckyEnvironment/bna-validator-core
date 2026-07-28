// SPDX-License-Identifier: Apache-2.0

/**
 * The methodology version whose schema rules this module implements.
 * Changes that can move an existing score require a new major schema version
 * and 30 days' notice; see CONTRIBUTING.md.
 */
export const SCHEMA_VERSION = "0.1";

/** The A2A protocol revisions accepted by this schema version. */
export const A2A_PROTOCOL_VERSIONS = Object.freeze(["1.0"]);

/** The largest untrusted card document accepted by the validator (10 MiB). */
export const MAX_CARD_BYTES = 10 * 1024 * 1024;

/** The deepest object or array nesting accepted in an untrusted card. */
export const MAX_CARD_DEPTH = 32;

/**
 * @typedef {"required" | "bna" | "informational"} FieldKind
 *
 * `required` — an A2A field. Absent is blocking.
 *
 * `bna` — a BNA extension. Absent is a warning, and an error under `strict`.
 *
 * `informational` — a BNA extension whose absence carries no verdict at all.
 * It reports as `info` and is counted in neither `errors` nor `warns`, so a
 * card that declares nothing here still scores `ok`.
 *
 * The third kind exists because of one specific field. `x-bna.probe-key`
 * enables a vendor to countersign BNA's probes — a mechanism whose entire
 * purpose is to hold BNA accountable. If not publishing one cost the vendor a
 * verdict, an accountability mechanism would have become leverage over the
 * people being rated, which is the failure mode SURFACE-05 §4 names explicitly.
 * A missing receipt is absence of evidence, not evidence of absence, and the
 * `----` state in a probe verdict already says exactly that about a claim
 * nobody has checked. This is the same rule, one level up.
 *
 * `strict` still escalates it, because strict is a deliberate request to treat
 * every undeclared field as blocking.
 */
/** @typedef {"string" | "boolean" | "object" | "array:string" | "url" | "protocol-version" | "jwk"} ExpectedType */
/** @typedef {readonly [key: string, kind: FieldKind, why: string, expectedType: ExpectedType]} CardSchemaField */
/** @typedef {{ key: string, kind: FieldKind, level: "ok" | "info" | "warn" | "err", msg: string, why: string }} FieldResult */

/**
 * The authoritative, versioned BNA agent-card schema.
 *
 * BNA extensions use flat keys (`x-bna.residency`) as their canonical form.
 * The legacy nested form (`x-bna: { residency: ... }`) is accepted with a
 * non-blocking style warning so existing cards retain their declaration.
 */
export const CARD_SCHEMA = /** @type {readonly CardSchemaField[]} */ (Object.freeze([
  Object.freeze(["protocolVersion", "required", "Protocol version the card conforms to.", "protocol-version"]),
  Object.freeze(["name", "required", "Human-readable display name.", "string"]),
  Object.freeze(["description", "required", "What the agent does.", "string"]),
  Object.freeze(["version", "required", "Semantic version.", "string"]),
  Object.freeze(["url", "required", "Primary A2A endpoint.", "url"]),
  Object.freeze(["provider.name", "required", "Operator name.", "string"]),
  Object.freeze(["capabilities", "required", "Declared protocol capabilities.", "object"]),
  Object.freeze(["defaultInputModes", "required", "Accepted media types.", "array:string"]),
  Object.freeze(["defaultOutputModes", "required", "Returned media types.", "array:string"]),
  Object.freeze(["skills", "required", "At least one skill.", "array:string"]),
  Object.freeze(["x-bna.residency", "bna", "Where data is processed.", "string"]),
  Object.freeze(["x-bna.zdr", "bna", "Whether payloads are retained.", "boolean"]),
  Object.freeze(["x-bna.compliance", "bna", "Certifications held.", "array:string"]),
  Object.freeze(["x-bna.pricing", "bna", "Charging model and rates.", "object"]),
  Object.freeze(["x-bna.contact", "bna", "Operations contact.", "string"]),
  Object.freeze(["x-bna.probe-key", "informational", "Public key that countersigns probes.", "jwk"])
]));

/**
 * Version metadata published alongside CARD_SCHEMA for consumers that need to
 * label validation results without duplicating protocol or extension rules.
 */
export const SCHEMA_METADATA = Object.freeze({
  methodologyVersion: SCHEMA_VERSION,
  a2aProtocolVersions: A2A_PROTOCOL_VERSIONS,
  canonicalExtensionFormat: "flat"
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * UTF-8 byte length, counted without allocating and without Node globals.
 *
 * The console imports this module directly so that a card is scored in the
 * browser by the same bytes the CLI runs — `Buffer` is not available there,
 * and encoding a 10 MiB card just to measure it would be wasteful anywhere.
 * Lone surrogates count as 3 bytes, matching the U+FFFD substitution that
 * both `Buffer.byteLength` and `TextEncoder` perform.
 *
 * @param {string} value
 * @returns {number}
 */
function utf8Length(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
      continue;
    }
    if (code < 0x800) {
      bytes += 2;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
        continue;
      }
    }
    bytes += 3;
  }
  return bytes;
}

/**
 * Return an own data-property value without consulting a prototype or invoking
 * a getter. The validator must not execute code supplied by an untrusted card.
 *
 * @param {Record<string, unknown>} object
 * @param {string} key
 * @returns {{ found: boolean, value?: unknown }}
 */
function getOwnValue(object, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return { found: false };
    return { found: true, value: descriptor.value };
  } catch {
    return { found: false };
  }
}

/**
 * Resolve a dotted core-schema path using only own data properties.
 *
 * @param {Record<string, unknown>} object
 * @param {string} path
 * @returns {{ found: boolean, value?: unknown }}
 */
function getPathValue(object, path) {
  /** @type {unknown} */
  let current = object;
  for (const key of path.split(".")) {
    if (!isRecord(current)) return { found: false };
    const result = getOwnValue(current, key);
    if (!result.found) return result;
    current = result.value;
  }
  return { found: true, value: current };
}

/**
 * Resolve canonical flat BNA keys first and then the accepted legacy nesting.
 *
 * @param {Record<string, unknown>} card
 * @param {string} key
 * @returns {{ found: boolean, value?: unknown, nested: boolean }}
 */
function getFieldValue(card, key) {
  const canonical = getOwnValue(card, key);
  if (canonical.found && hasValue(canonical.value)) {
    return { ...canonical, nested: false };
  }

  if (!key.startsWith("x-bna.")) return { ...getPathValue(card, key), nested: false };

  const namespace = getOwnValue(card, "x-bna");
  if (!namespace.found || !isRecord(namespace.value)) return { ...canonical, nested: false };
  const nested = getOwnValue(namespace.value, key.slice("x-bna.".length));
  return nested.found && hasValue(nested.value)
    ? { ...nested, nested: true }
    : { ...canonical, nested: false };
}

/**
 * Empty strings are absent. Zero and false are deliberately present values.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/**
 * Verify that a document can be safely traversed without invoking accessors,
 * exhausting the validator, following cycles, or exceeding the size limit.
 *
 * @param {unknown} value
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
function inspectCard(value) {
  if (!isRecord(value)) return { valid: false, reason: "card must be an object" };

  let bytes = 0;
  /** @type {WeakSet<object>} */
  const ancestors = new WeakSet();

  /**
   * @param {unknown} current
   * @param {number} depth
   * @returns {{ valid: true } | { valid: false, reason: string }}
   */
  function visit(current, depth) {
    if (depth > MAX_CARD_DEPTH) return { valid: false, reason: `card exceeds depth limit of ${MAX_CARD_DEPTH}` };

    if (typeof current === "string") {
      bytes += utf8Length(current);
    } else if (current === null || typeof current !== "object") {
      bytes += 8;
    } else {
      if (ancestors.has(current)) return { valid: false, reason: "card contains a circular reference" };
      ancestors.add(current);

      let keys;
      try {
        keys = Object.keys(current);
      } catch {
        return { valid: false, reason: "card properties cannot be inspected" };
      }

      for (const key of keys) {
        bytes += utf8Length(key);
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(current, key);
        } catch {
          return { valid: false, reason: "card properties cannot be inspected" };
        }
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          return { valid: false, reason: "card contains an accessor property" };
        }
        const result = visit(descriptor.value, depth + 1);
        if (!result.valid) return result;
        if (bytes > MAX_CARD_BYTES) return { valid: false, reason: `card exceeds size limit of ${MAX_CARD_BYTES} bytes` };
      }
      ancestors.delete(current);
    }

    return bytes > MAX_CARD_BYTES
      ? { valid: false, reason: `card exceeds size limit of ${MAX_CARD_BYTES} bytes` }
      : { valid: true };
  }

  return visit(value, 0);
}

/**
 * @param {unknown} value
 * @param {ExpectedType} expectedType
 * @returns {boolean}
 */
function matchesType(value, expectedType) {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array:string":
      return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
    case "url":
      if (typeof value !== "string") return false;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    case "protocol-version":
      return typeof value === "string" && A2A_PROTOCOL_VERSIONS.includes(value);
    case "jwk":
      return isPublicJwk(value);
  }
}

/**
 * A public JWK of a kind BNA can verify a probe receipt with.
 *
 * The structure is checked, not merely the presence of an object. A card that
 * declares a malformed key is worse than one that declares none: it advertises
 * an attestation path that cannot work, and the vendor has no way to discover
 * that from their own side. So a bad key is a type error and travels the
 * existing wrong-type path — a warning normally, an error under --strict —
 * rather than being silently treated as absent.
 *
 * Private key material is refused outright. A `d` parameter in a published card
 * is a catastrophic operator mistake, and the one moment it can be caught for
 * them is here.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPublicJwk(value) {
  if (!isRecord(value)) return false;

  const nonEmpty = (/** @type {unknown} */ item) => typeof item === "string" && item.length > 0;

  // Never accept anything carrying a private component.
  for (const secret of ["d", "p", "q", "dp", "dq", "qi", "k"]) {
    if (secret in value) return false;
  }

  if (!nonEmpty(value.kid)) return false;

  if (value.kty === "OKP") {
    // Ed25519 only. Other curves are not a BNA receipt algorithm, and
    // accepting one would publish a key nothing can verify against.
    return value.crv === "Ed25519" && nonEmpty(value.x);
  }

  if (value.kty === "RSA") {
    return nonEmpty(value.n) && nonEmpty(value.e);
  }

  return false;
}

/**
 * Read a schema field's declared value using exactly the rules validateCard
 * applies — canonical flat key first, then the accepted legacy nesting.
 *
 * Renderers need this. A card that declares `x-bna.residency` in the nested
 * form is a card that declared it, and any surface that reads the flat key
 * alone will tell a compliant vendor their residency is undeclared. That is
 * the one thing this validator exists to prevent, so the lookup is published
 * rather than left for each caller to approximate.
 *
 * `declared` says only that the vendor stated a value. It carries no claim
 * that BNA observed or agreed with it.
 *
 * @param {unknown} card
 * @param {string} key
 * @returns {{ declared: boolean, value?: unknown, nested: boolean }}
 */
export function readCardField(card, key) {
  if (!isRecord(card)) return { declared: false, nested: false };
  const field = getFieldValue(card, key);
  if (!field.found || !hasValue(field.value)) return { declared: false, nested: false };
  return { declared: true, value: field.value, nested: field.nested };
}

/**
 * Validate an untrusted A2A agent card against the authoritative BNA schema.
 * Validation is local only: endpoint reachability and other network
 * observations belong to the probing service, not this pure schema check.
 *
 * @param {unknown} card
 * @param {{ strict?: boolean } | undefined} [options]
 * @returns {{ verdict: "ok" | "warn" | "err", errors: number, warns: number, infos: number, fields: Array<{ key: string, kind: FieldKind, level: "ok" | "info" | "warn" | "err", msg: string, why: string }> }}
 */
export function validateCard(card, options = {}) {
  const strict = options?.strict === true;
  const inspection = inspectCard(card);

  /** @type {FieldResult[]} */
  const fields = CARD_SCHEMA.map(/** @returns {FieldResult} */ ([key, kind, why, expectedType]) => {
    if (!inspection.valid || !isRecord(card)) {
      const reason = inspection.valid ? "card must be an object" : inspection.reason;
      return { key, kind, level: "err", msg: `Invalid card — ${reason}.`, why };
    }

    const field = getFieldValue(card, key);
    if (!field.found || !hasValue(field.value)) {
      if (kind === "required" || strict) {
        return { key, kind, level: "err", msg: "Missing — blocking.", why };
      }
      if (kind === "informational") {
        return { key, kind, level: "info", msg: "Not declared — no verdict either way.", why };
      }
      return { key, kind, level: "warn", msg: "Not declared — safe default will apply.", why };
    }

    if (!matchesType(field.value, expectedType)) {
      const level = kind === "required" || strict ? "err" : "warn";
      return { key, kind, level, msg: `Invalid type — expected ${expectedType}.`, why };
    }

    if (field.nested) {
      return {
        key,
        kind,
        level: "warn",
        msg: "Declared using nested extension form — use the canonical flat key.",
        why
      };
    }

    return { key, kind, level: "ok", msg: "Present", why };
  });

  const errors = fields.filter((field) => field.level === "err").length;
  const warns = fields.filter((field) => field.level === "warn").length;
  const infos = fields.filter((field) => field.level === "info").length;

  // `info` is deliberately absent from this expression. A field that reports
  // `info` can never move a verdict, which is the whole point of the kind.
  const verdict = errors > 0 ? "err" : warns > 0 ? "warn" : "ok";

  return { verdict, errors, warns, infos, fields };
}
