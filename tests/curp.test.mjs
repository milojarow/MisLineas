import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/curp.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
});
const { maskCurpForDisplay } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("recent searches never expose a complete CURP", () => {
  const curp = "HEGG560427MVZRRL04";
  const masked = maskCurpForDisplay(curp);

  assert.equal(masked, "••••••••••••••••04");
  assert.equal(masked.includes(curp), false);
  assert.equal(/^[A-Z]{4}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/.test(masked), false);
});
