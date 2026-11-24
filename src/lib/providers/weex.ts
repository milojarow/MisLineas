import { PROVIDER_TIMEOUT_MS } from "@/lib/data/content";
import { stripCURPs } from "@/lib/sanitize";
import type { LineResult } from "@/types";

const DOCUMENT_TYPE_CURP = 1;

type WeexResponse = {
  obj?: { dnActiveByCurpRfc?: Array<{ msisdn?: string; provider?: string }> };
  error?: { code?: number; message?: string; retry?: number };
};

export async function loookupCURPINWeeex(curp: string): Promise<LineResult> {
  const validationResponse = await fetch(
    "https://app.weex.mx/ServiceLayer/Legislacion?ex=getDnActiveLines",
    {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentType: DOCUMENT_TYPE_CURP,
        searchData: curp,
      }),
    },
  );

  if (!validationResponse.ok) {
    console.error(
      "Failed to validate CURP with Weex:",
      validationResponse.statusText,
    );
    const blocked =
      validationResponse.status === 403 || validationResponse.status === 429;
    return {
      company: "Weex",
      lines: [],
      temporaryUnavailable: blocked,
      error: blocked ? undefined : "Failed to validate CURP with Weex",
    };
  }

  const validationData = (await validationResponse
    .json()
    .catch(() => null)) as WeexResponse | null;

  if (
    validationData?.error?.code !== undefined &&
    validationData.error.code !== 0
  ) {
    console.error(
      `[weex] business error ${validationData.error.code}: ${validationData.error.message ?? ""}`,
    );
    return { company: "Weex", lines: [], temporaryUnavailable: true };
  }

  const found = validationData?.obj?.dnActiveByCurpRfc;

  if (!Array.isArray(found)) {
    console.error(
      "[weex] unrecognized response shape, refusing to guess:",
      JSON.stringify(stripCURPs(validationData), null, 2),
    );
    return {
      company: "Weex",
      lines: [],
      error: "Unrecognized response shape from Weex",
    };
  }

  if (found.length === 0) {
    return { company: "Weex", lines: [], isRegistered: false };
  }

  console.log(
    "[weex] registered response:",
    JSON.stringify(stripCURPs(validationData), null, 2),
  );
  return {
    company: "Weex",
    lines: [],
    isRegistered: true,
    rawApiResponse: validationData,
  };
}
