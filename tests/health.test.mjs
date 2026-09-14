// Prueba del healthcheck (api/health.js) sin red: fetch se reemplaza por uno
// simulado. Revisa que responda JSON, 200 si Supabase anda y 503 si no, y
// que le pregunte a la URL de js/config.js.
import { createRequire } from 'node:module';

const health = createRequire(import.meta.url)('../api/health.js');
let fallas = 0;
const ok = (cond, msg) => {
  if (!cond) fallas++;
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};

const llamar = async simulado => {
  const pedidos = [];
  globalThis.fetch = async (url, opciones) => { pedidos.push({ url, opciones }); return simulado(); };
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(cuerpo) { this.cuerpo = cuerpo; } };
  await health({ method: 'GET', url: '/api/health' }, res);
  return { res, json: JSON.parse(res.cuerpo), pedidos };
};

{
  const { res, json, pedidos } = await llamar(() => ({ ok: true, status: 200 }));
  ok(res.statusCode === 200 && json.status === 'ok' && json.dependencias.supabase.status === 'ok',
     `con Supabase disponible: 200 y status "ok" (${res.statusCode} ${json.status})`);
  ok(/^application\/json/.test(res.headers['content-type']) && res.headers['cache-control'] === 'no-store',
     'responde JSON y sin caché');
  ok(pedidos.length === 1 && /^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1\/health$/.test(pedidos[0].url)
     && /^sb_publishable_/.test(pedidos[0].opciones.headers.apikey),
     `le pregunta a Supabase con la URL y la clave pública de js/config.js (${pedidos[0] && pedidos[0].url})`);
  ok(typeof json.version === 'string' && !Number.isNaN(Date.parse(json.fecha)), 'incluye versión y fecha');
}
{
  const { res, json } = await llamar(() => ({ ok: false, status: 500 }));
  ok(res.statusCode === 503 && json.status === 'degraded', `si Supabase responde con error: 503 y "degraded" (${res.statusCode})`);
}
{
  const { res, json } = await llamar(() => { throw new TypeError('fetch failed'); });
  ok(res.statusCode === 503 && json.dependencias.supabase.detalle === 'sin conexión', `si no hay conexión: 503 y lo dice (${json.dependencias.supabase.detalle})`);
}

console.log(fallas ? `\n✗ ${fallas} pruebas fallaron` : '\n✓ todas las pruebas pasaron');
process.exitCode = fallas ? 1 : 0;
