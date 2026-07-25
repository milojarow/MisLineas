// Runs once when the Next server boots (before handling requests).
// Pre-warms the systemd-resolved DNS cache for every active provider host, so
// the FIRST user query doesn't hit a cold cache + connection pool at the same
// time and get spurious ENOTFOUND from the resolver under the ~13-host burst.
// Best-effort and fire-and-forget: never blocks startup, never throws.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // CAUSA RAÍZ del timeout intermitente de AT&T (y ECONNRESET de Dialo): undici (el
  // motor de fetch de Node) mantiene sockets keep-alive idle hasta ~600s, pero
  // att.com.mx / la API de Dialo cierran el socket idle a ~30s. undici reusa el
  // socket muerto, escribe la request encima, y cuelga los 50s del AbortSignal.
  // Fix: keepAliveMaxTimeout corto (8s) -> undici desaloja el socket idle ANTES de
  // que el server lo cierre, así nunca reusa un cadáver. headersTimeout corto ->
  // si aun así pega uno muerto, falla en ~15s en vez de 50s. Cubre las 13 operadoras.
  const { Agent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(
    new Agent({
      // allowH2:false -> sin HTTP/2. Una conexión H2 multiplexada que queda stale
      // tumba TODAS las requests encima (el "HTTP/2 headers timeout" observado).
      // Con HTTP/1.1 cada socket es independiente.
      allowH2: false,
      // keep-alive corto: undici desaloja el socket idle (~10s) ANTES de que la
      // operadora lo cierre (~30s) -> evita reusar un socket muerto (stale reuse).
      keepAliveTimeout: 10000,
      keepAliveMaxTimeout: 10000,
      // connect generoso: NO cortar handshakes legítimos bajo carga del proceso de
      // larga vida. El AbortSignal.timeout(50000) por-provider es el techo duro;
      // dejar headersTimeout/bodyTimeout en sus defaults amplios de undici.
      connect: { timeout: 30000 },
    }),
  );

  const { lookup } = await import("node:dns/promises");

  const hosts = [
    "att.com.mx",
    "registro.telcel.com",
    "rnu.altanredes.com",
    "erp.abib.com.mx",
    "core.beneleit.talentonet.com",
    "p737drx1pj.execute-api.us-east-1.amazonaws.com",
    "api-iso-prod.ientc.dev",
    "ku.diri.mx",
    "apib.mirlo.com",
    "mobig.mx",
    "www.virginmobile.mx",
    "vinculatulinea.com",
  ];

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const warm = async (host: string) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await lookup(host);
        return;
      } catch {
        // The warm-up itself can saturate the resolver on a cold start; retry
        // with backoff so the cache ends up populated either way.
        await sleep(250 * (attempt + 1));
      }
    }
  };

  // BLOQUEANTE a propósito (await, no fire-and-forget): register() retrasa el primer
  // request hasta que el caché DNS de TODOS los hosts está caliente. Si no, la primera
  // consulta (apenas sale "Ready") pega DNS frío + 13 fetches concurrentes ->
  // systemd-resolved se satura -> AT&T cae en timeout (el síntoma reportado). Tardar
  // unos segundos más en arrancar vale: la PRIMERA consulta ya funciona.
  // Resolvemos en lotes pequeños para no recrear la ráfaga que queremos evitar.
  const batchSize = 4;
  for (let i = 0; i < hosts.length; i += batchSize) {
    await Promise.allSettled(hosts.slice(i, i + batchSize).map(warm));
  }
}
