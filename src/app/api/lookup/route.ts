import type { NextRequest } from "next/server";
import {
  lookupCURPINMobig,
  lookupCURPInAltanMVNO,
  lookupCURPInBeneleit,
  lookupCURPInIENTC,
  lookupCURPInLogisticaACN,
  lookupCURPInMirlo,
  lookupCURPInTelcel,
  lookupCURPInViasat,
  lookupCURPInVinculatulinea,
  lookupCURPInVinoc,
  loookupCURPINWeeex,
  loookupCURPInVirginMobile,
} from "@/lib/providers";
import { validateCURP } from "@/lib/providers/curp";
import { checkRateLimit } from "@/lib/rate-limit";
import { stripCURPs } from "@/lib/sanitize";
import type { LineResult } from "@/types";

const providers: Array<{
  provider: string;
  lookupFunction: (curp: string) => Promise<LineResult>;
}> = [
  // {
  //   provider: "AT&T",
  //   lookupFunction: lookupCURPInATT,
  //   // Disabled: att.com.mx answers 403 to the plain session/initlines POST from
  //   // every origin we measured (residential line and datacenter alike) — it is a
  //   // bot-fingerprint block, not an IP block. Reaching it needs a real browser
  //   // through a residential proxy, which upstream built and then dropped because
  //   // it burned ~95% of their proxy bandwidth. The UI points users to att.com.mx.
  // },
  {
    provider: "Telcel",
    lookupFunction: lookupCURPInTelcel,
  },
  {
    provider: "Altan MVNO",
    lookupFunction: lookupCURPInAltanMVNO,
  },
  {
    provider: "Beneleit Móvil",
    lookupFunction: lookupCURPInBeneleit,
  },
  // ABIB is now covered by the Altan lookup above. Its old direct endpoint
  // redirects to a login and no longer accepts public CURP queries.
  // Dialo is disabled because its API host no longer resolves.
  {
    provider: "IENTC",
    lookupFunction: lookupCURPInIENTC,
  },
  {
    provider: "Logistica ACN (FedeGo!, Flash Mobile, Dua)",
    lookupFunction: lookupCURPInLogisticaACN,
  },
  // {
  //   provider: "Mega Móvil",
  //   lookupFunction: lookupCURPInMegamovil,
  //   // Disabled: WAF blocks server IP (Attack ID: 20000018)
  // },
  {
    provider: "Mirlo",
    lookupFunction: lookupCURPInMirlo,
  },
  {
    provider: "MoBig",
    lookupFunction: lookupCURPINMobig,
  },
  // {
  //   provider: "Nextor Movil",
  //   lookupFunction: lookupCURPINNextorMovil,
  //   // Disabled: rate limit
  // },
  // {
  //   provider: "Sorcel",
  //   lookupFunction: lookupCURPInSorcel,
  //   // Disabled: Cloudflare JS challenge blocks server-side requests
  // },
  // {
  //   provider: "TalentoNet (Newww, Red Aguila, Link Móvil)",
  //   lookupFunction: loookupCURPInTalentoNetMVNO,
  //   // Disabled: ConnectTimeoutError on core.newww.mx:443
  // },
  {
    provider: "Virgin Mobile",
    lookupFunction: loookupCURPInVirginMobile,
  },
  {
    provider: "Weex",
    lookupFunction: loookupCURPINWeeex,
  },
  {
    provider: "Viasat",
    lookupFunction: lookupCURPInViasat,
  },
  {
    provider: "Vinoc",
    lookupFunction: lookupCURPInVinoc,
  },
  {
    provider:
      "Vinculatulinea (Freedompop/OUI/OXXO CEL/Uber Cel/AhorroCel/Chedraui Móvil/Yobi Telecom)",
    lookupFunction: lookupCURPInVinculatulinea,
  },
  // {
  //   provider: "Yo Mobile",
  //   lookupFunction: lookupCURPINYoMobile,
  // },
];

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, remaining } = checkRateLimit(ip);

  if (!allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const { curp } = await req.json();

  if (!curp || typeof curp !== "string") {
    return new Response(
      JSON.stringify({ error: "CURP is required and must be a string" }),
      { status: 400 },
    );
  }

  const isValidCURP = validateCURP(curp);

  if (!isValidCURP) {
    return new Response(JSON.stringify({ error: "Invalid CURP format" }), {
      status: 400,
    });
  }

  // Use a streaming response to return results as soon as they resolve
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // systemd-resolved (127.0.0.53) devuelve ENOTFOUND/timeout espurios cuando le
      // llega una ráfaga de ~20 resoluciones DNS a la vez (los 13 providers en
      // paralelo, cada uno con A+AAAA). Mitigación de raíz:
      //   1) limitar la concurrencia para no saturar el resolver, y
      //   2) reintentar fallos de red transitorios: el 2º intento ya pega al caché
      //      caliente de systemd-resolved y resuelve.
      // Así la consulta siempre termina con resultado real, aunque tarde un poco más.
      const CONCURRENCY = 5;
      const MAX_RETRIES = 2;
      // Reintentar SOLO fallos transitorios de DNS/conexión que el 2º intento (con
      // caché caliente) resuelve. NO reintentar "aborted due to timeout": un
      // AbortSignal de 50s no es un fallo de DNS, es saturación/stale-socket, y el
      // reintento solo amplifica la espera a 100-300s (hallazgo adversarial #2).
      const TRANSIENT = /fetch failed|ENOTFOUND|EAI_AGAIN/i;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      const lookupWithRetry = async (p: (typeof providers)[number]) => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            const result = await p.lookupFunction(curp);
            if (
              result?.error &&
              TRANSIENT.test(result.error) &&
              attempt < MAX_RETRIES
            ) {
              await sleep(300 * (attempt + 1));
              continue;
            }
            return { provider: p.provider, result };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown error";
            if (TRANSIENT.test(message) && attempt < MAX_RETRIES) {
              await sleep(300 * (attempt + 1));
              continue;
            }
            console.error(
              `Lookup failed for ${p.provider}:`,
              String(stripCURPs(message)),
            );
            return {
              provider: p.provider,
              result: {
                company: p.provider,
                lines: [],
                error: `Lookup failed: ${message}`,
              },
            };
          }
        }
      };

      const queue = [...providers];
      const worker = async () => {
        for (;;) {
          const p = queue.shift();
          if (!p) return;
          const response = await lookupWithRetry(p);
          controller.enqueue(
            encoder.encode(`${JSON.stringify(stripCURPs(response))}\n`),
          );
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, providers.length) }, worker),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-RateLimit-Remaining": String(remaining),
    },
  });
}
