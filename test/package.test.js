// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const repo = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.join(repo, ".package-smoke");

/** @param {string[]} args @param {string} cwd @returns {string} */
function execNpm(args, cwd) {
  return execFileSync(npm, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Run the repo's TypeScript compiler against a scratch project.
 *
 * @param {string} cwd
 * @returns {{ ok: true } | { ok: false, output: string }}
 */
function typecheck(cwd) {
  const tsc = path.join(repo, "node_modules", "typescript", "bin", "tsc");
  try {
    execFileSync(process.execPath, [tsc, "--noEmit", "--project", cwd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true };
  } catch (error) {
    const failure = /** @type {{ stdout?: string, stderr?: string }} */ (error);
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

test("packed tarball ships declarations that a consumer project can actually use", () => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });

  /** @type {string | undefined} */
  let tarball;
  try {
    // `prepack` runs `build:types`, so packing is what proves the declarations
    // are emitted at publish time rather than only in a dirty working tree.
    fs.rmSync(path.join(repo, "types"), { recursive: true, force: true });
    const packed = /** @type {Array<{ filename: string, files: Array<{ path: string }> }>} */ (
      JSON.parse(execNpm(["pack", "--json"], repo))
    );
    tarball = path.join(repo, packed[0].filename);
    const files = packed[0].files.map((entry) => entry.path);

    assert.ok(files.includes("types/index.d.ts"), "tarball is missing the generated declarations");
    assert.ok(files.includes("src/index.js"), "tarball is missing the published source");
    assert.ok(files.includes("LICENSE") && files.includes("NOTICE"), "tarball is missing licensing files");
    assert.ok(
      files.every((file) => !file.startsWith("test/") && !file.startsWith("coverage/") && !file.includes(".env")),
      `tarball contains files that should not be published: ${files.join(", ")}`
    );

    // Written directly rather than via `npm init`, which rejects the
    // dot-prefixed scratch directory as an invalid package name.
    fs.writeFileSync(
      path.join(scratch, "package.json"),
      JSON.stringify({ name: "validator-core-smoke", version: "1.0.0", private: true, type: "module" })
    );
    execNpm(
      ["install", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", "--offline", tarball],
      scratch
    );

    // Runtime: the published bytes are the executed bytes — no build step.
    const runtime = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import { validateCard, SCHEMA_VERSION } from "@bna/validator-core";' +
          'const card = JSON.parse(process.env.CARD);' +
          'process.stdout.write(JSON.stringify({ v: validateCard(card).verdict, schema: SCHEMA_VERSION }));'
      ],
      {
        cwd: scratch,
        encoding: "utf8",
        env: {
          ...process.env,
          CARD: fs.readFileSync(fileURLToPath(new URL("./fixtures/valid-card.json", import.meta.url)), "utf8")
        }
      }
    );
    assert.deepEqual(JSON.parse(runtime), { v: "ok", schema: "0.1" });

    fs.writeFileSync(
      path.join(scratch, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { module: "nodenext", moduleResolution: "nodenext", strict: true, noEmit: true, types: [] },
        files: ["consumer.ts"]
      })
    );

    // Types resolve and describe the real return shape.
    fs.writeFileSync(
      path.join(scratch, "consumer.ts"),
      'import { validateCard, CARD_SCHEMA, SCHEMA_VERSION } from "@bna/validator-core";\n' +
        "const report = validateCard({}, { strict: true });\n" +
        'const verdict: "ok" | "warn" | "err" = report.verdict;\n' +
        "const errors: number = report.errors;\n" +
        "const keys: string[] = report.fields.map((field) => field.key);\n" +
        "const version: string = SCHEMA_VERSION;\n" +
        "const size: number = CARD_SCHEMA.length;\n" +
        "void [verdict, errors, keys, version, size];\n"
    );
    const valid = typecheck(scratch);
    assert.ok(valid.ok, `declarations rejected a correct consumer:\n${valid.ok ? "" : valid.output}`);

    // Negative control: if the declarations were missing or silently `any`,
    // this would also pass and the check above would prove nothing.
    fs.writeFileSync(
      path.join(scratch, "consumer.ts"),
      'import { validateCard } from "@bna/validator-core";\n' +
        "const wrong: number = validateCard({}).verdict;\n" +
        "void wrong;\n"
    );
    const invalid = typecheck(scratch);
    assert.equal(invalid.ok, false, "declarations did not reject assigning a verdict to a number — types are not being applied");
    assert.match(invalid.ok ? "" : invalid.output, /not assignable to type 'number'/);
  } finally {
    if (tarball) fs.rmSync(tarball, { force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
