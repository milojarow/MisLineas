import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

async function loadProvider(relativePath) {
  const source = readFileSync(
    new URL(`../src/lib/providers/${relativePath}`, import.meta.url),
    "utf8",
  )
    .replace(
      'import { PROVIDER_TIMEOUT_MS } from "@/lib/data/content";',
      "const PROVIDER_TIMEOUT_MS = 50_000;",
    )
    .replace(
      'import { stripCURPs } from "@/lib/sanitize";',
      "const stripCURPs = (value) => value;",
    );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });

  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}#${relativePath}`
  );
}

async function withFetch(body, lookup) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => structuredClone(body),
  });
  try {
    return await lookup();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Viasat accepts only an explicit active line", async () => {
  const { lookupCURPInViasat } = await loadProvider("viasat.ts");

  const positive = await withFetch(
    {
      result: "success",
      data: { list: [{ DN: "5512346789", linkStatus: "LINKED" }] },
    },
    () => lookupCURPInViasat("XXXX010101HNEXXX09"),
  );
  assert.equal(positive.isRegistered, true);
  assert.deepEqual(positive.lines, ["Viasat: ******6789"]);

  const rejected = await withFetch(
    {
      result: "success",
      data: { list: [{ DN: "5512346789", linkStatus: "REJECTED" }] },
    },
    () => lookupCURPInViasat("XXXX010101HNEXXX09"),
  );
  assert.equal(rejected.isRegistered, false);

  const unknown = await withFetch({}, () =>
    lookupCURPInViasat("XXXX010101HNEXXX09"),
  );
  assert.match(unknown.error, /Unrecognized/);
  assert.notEqual(unknown.isRegistered, true);
});

test("Vinoc requires found=true and a masked line", async () => {
  const { lookupCURPInVinoc } = await loadProvider("vinoc.ts");

  const positive = await withFetch(
    {
      found: true,
      lines: [{ msisdn_masked: "******6789", provider: "Vinoc" }],
    },
    () => lookupCURPInVinoc("XXXX010101HNEXXX09"),
  );
  assert.equal(positive.isRegistered, true);
  assert.deepEqual(positive.lines, ["Vinoc: ******6789"]);

  const empty = await withFetch({ found: false, lines: [] }, () =>
    lookupCURPInVinoc("XXXX010101HNEXXX09"),
  );
  assert.equal(empty.isRegistered, false);

  const unknown = await withFetch({}, () =>
    lookupCURPInVinoc("XXXX010101HNEXXX09"),
  );
  assert.match(unknown.error, /Unrecognized/);
  assert.notEqual(unknown.isRegistered, true);
});

test("Weex distinguishes lines, empty results, and broken envelopes", async () => {
  const { loookupCURPINWeeex } = await loadProvider("weex.ts");

  const positive = await withFetch(
    {
      obj: { dnActiveByCurpRfc: [{ msisdn: "5512346789" }] },
      error: { code: 0 },
    },
    () => loookupCURPINWeeex("XXXX010101HNEXXX09"),
  );
  assert.equal(positive.isRegistered, true);

  const empty = await withFetch(
    { obj: { dnActiveByCurpRfc: [] }, error: { code: 0 } },
    () => loookupCURPINWeeex("XXXX010101HNEXXX09"),
  );
  assert.equal(empty.isRegistered, false);

  const unknown = await withFetch({}, () =>
    loookupCURPINWeeex("XXXX010101HNEXXX09"),
  );
  assert.match(unknown.error, /Unrecognized/);
  assert.notEqual(unknown.isRegistered, true);
});
