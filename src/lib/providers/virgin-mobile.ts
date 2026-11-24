import { stripCURPs } from "@/lib/sanitize";
import type { LineResult } from "@/types";

export async function loookupCURPInVirginMobile(
  curp: string,
): Promise<LineResult> {
  const validationBody = {
    tipo_documento: "CURP",
    id_documento: curp,
  };

  const validationResponse = await fetch(
    "https://www.virginmobile.mx/api/v1/public/consulta-linea/findMsisdn",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validationBody),
      signal: AbortSignal.timeout(50000),
    },
  );

  if (!validationResponse.ok) {
    console.error(
      "Failed to validate CURP with Virgin Mobile:",
      validationResponse.statusText,
    );

    return {
      company: "Virgin Mobile",
      lines: [],
      error: "Failed to validate CURP with Virgin Mobile",
    };
  }

  const validationData = await validationResponse.json();
  const totalLineas = validationData?.data?.total_lineas;

  if (typeof totalLineas !== "number") {
    console.error(
      "[virgin-mobile] unrecognized response shape, refusing to guess:",
      JSON.stringify(stripCURPs(validationData), null, 2),
    );
    return {
      company: "Virgin Mobile",
      lines: [],
      error: "Unrecognized response shape from Virgin Mobile",
    };
  }

  if (totalLineas === 0) {
    return {
      company: "Virgin Mobile",
      lines: [],
      isRegistered: false,
    };
  }

  return {
    company: "Virgin Mobile",
    lines: validationData.data?.lineas || [],
    isRegistered: true,
    rawApiResponse: validationData,
  };
}
