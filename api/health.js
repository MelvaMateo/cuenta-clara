/* Healthcheck: GET /api/health responde en JSON si el sitio y su base de datos
   (Supabase) están disponibles. 200 con status "ok" si todo anda; 503 con
   status "degraded" si Supabase no responde. No lee ni toca ningún dato.

   A Supabase se le pregunta por su propio endpoint de salud, con la clave
   pública. La URL y la clave se leen de js/config.js, así viven en un solo
   lugar (vercel.json incluye ese archivo en la función). */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ESPERA_MAXIMA_MS = 3000;

function leerConfig() {
  const texto = readFileSync(join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const valor = nombre => (texto.match(new RegExp(`const ${nombre} *= *'([^']+)'`)) || [])[1];
  return { url: valor('SUPABASE_URL'), clave: valor('SUPABASE_ANON_KEY') };
}

async function revisarSupabase({ url, clave }) {
  const inicio = Date.now();
  try {
    const r = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: clave },
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
    return { status: r.ok ? 'ok' : 'error', http: r.status, ms: Date.now() - inicio };
  } catch (e) {
    return {
      status: 'error',
      detalle: e.name === 'TimeoutError' ? `sin respuesta en ${ESPERA_MAXIMA_MS} ms` : 'sin conexión',
      ms: Date.now() - inicio,
    };
  }
}

module.exports = async function health(req, res) {
  const supabase = await revisarSupabase(leerConfig());
  const ok = supabase.status === 'ok';
  res.statusCode = ok ? 200 : 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    status: ok ? 'ok' : 'degraded',
    servicio: 'cuenta-clara',
    version: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
    fecha: new Date().toISOString(),
    dependencias: { supabase },
  }));
};
