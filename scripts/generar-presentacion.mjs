// Genera presentacion.html: un solo archivo, sin nada externo, con capturas
// reales de la app embebidas como data: URI. Parte de
// docs/presentacion-fuente.html y reemplaza cada src="captura:NOMBRE" por su
// imagen. Se corre a mano cuando cambia la app o el texto:
//
//   node scripts/generar-presentacion.mjs
//
// Las capturas salen de la app de verdad, en Chrome, con los datos de muestra
// (sql/07_datos_muestra.sql) calculados por PGlite y un Supabase simulado que
// solo lee: no hace falta sesión ni red.
import { PGlite } from '@electric-sql/pglite';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const espera = ms => new Promise(r => setTimeout(r, ms));
const CHROME = [
  process.env.NAVEGADOR,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(r => r && existsSync(r));
if (!CHROME) {
  console.error('No se encontró Chrome: indicá la ruta en la variable NAVEGADOR.');
  process.exit(1);
}

// ------------------------------------------- los datos de muestra, calculados
const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  insert into auth.users (email) values ('odany_m@unitec.edu');
`);
for (const f of ['01_tablas', '02_migraciones', '03_indices', '04_seguridad', '05_calculos', '06_fotos', '07_datos_muestra']) {
  await db.exec(readFileSync(`${RAIZ}sql/${f}.sql`, 'utf8'));
}
const comoApi = filas => filas.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => {
  if (typeof v === 'bigint') return [k, Number(v)];
  if (v instanceof Date) return [k, k === 'fecha' && f.descripcion && f.tipo_cambio ? v.toISOString().slice(0, 10) : v.toISOString()];
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return [k, Number(v)];
  return [k, v];
})));
const datos = {
  cajas_resumen: comoApi((await db.query('select * from public.cajas_resumen')).rows),
  productos_costeados: comoApi((await db.query('select * from public.productos_costeados order by nombre')).rows),
  fiados: comoApi((await db.query('select * from public.fiados order by fecha desc')).rows),
};
await db.close();

// Un Supabase que solo lee: devuelve los datos de muestra y una sesión de ejemplo.
const SIMULADO = `
window.supabase = { createClient: () => {
  const datos = ${JSON.stringify(datos)};
  const consulta = tabla => {
    const q = { select() { return q; }, order() { return q; }, eq() { return q; },
      then(bien, mal) { return Promise.resolve({ data: datos[tabla] || [], error: null }).then(bien, mal); } };
    return q;
  };
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'muestra@cuenta-clara.test',
      user_metadata: { full_name: 'Emprendedora de ejemplo' } } } } }), signOut: async () => ({}) },
    from: consulta,
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
} };`;

// ------------------------------------------------------- el sitio, servido local
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
                '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const servidor = createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const archivo = join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  if (!archivo.startsWith(RAIZ.replace(/[\\/]$/, '')) || !existsSync(archivo) || !statSync(archivo).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': (TIPOS[extname(archivo)] || 'application/octet-stream') + '; charset=utf-8' });
  // El supabase-js simulado nunca coincide con el hash (SRI) del real: sin
  // quitar el integrity, Chrome no lo ejecuta y la app no pasa de "Verificando".
  const cuerpo = readFileSync(archivo);
  res.end(extname(archivo) === '.html' ? cuerpo.toString('utf8').replace(/ integrity="[^"]*"/g, '') : cuerpo);
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

// ------------------------------------------------------------------ capturas
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: process.platform === 'linux' ? ['--no-sandbox'] : [],
});
const page = await browser.newPage();
await page.setBypassServiceWorker(true);
await page.setRequestInterception(true);
page.on('request', r => (r.url().includes('supabase-js')
  ? r.respond({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: SIMULADO })
  : r.continue()));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${BASE}/app.html`, { waitUntil: 'networkidle0' });
await espera(1800);

const comoDato = bytes => `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;
const pantalla = async () => comoDato(await page.screenshot({ type: 'webp', quality: 70 }));
const pestaña = async id => {
  await page.$eval(`button[data-tab="${id}"]`, b => b.click());
  await espera(1600);                             // los indicadores terminan de contar
};

const capturas = {};
await pestaña('cajas');
capturas.cajas = await pantalla();
await pestaña('inventario');
capturas.stock = await pantalla();
await page.$eval('[data-abre="panelProducto"]', b => b.click());
await espera(500);
await page.type('#prodNombre', 'Organizador acrílico');
await page.type('#inpValor', '8');
await page.type('#inpPrecio', '150');
await espera(300);
await page.$eval('#panelProducto', el => el.scrollIntoView({ block: 'start' }));
await espera(300);
capturas.producto = await pantalla();
await page.$eval('[data-abre="panelProducto"]', b => b.click());
await pestaña('fiados');
capturas.fiados = await pantalla();
await pestaña('resumen');
capturas.resumen = await pantalla();
await browser.close();
servidor.close();

// --------------------------------------------------- el archivo autocontenido
let html = readFileSync(`${RAIZ}docs/presentacion-fuente.html`, 'utf8');
for (const [nombre, dato] of Object.entries(capturas)) {
  const marca = `src="captura:${nombre}"`;
  if (!html.includes(marca)) throw new Error(`la fuente no tiene ${marca}`);
  html = html.replace(marca, `src="${dato}"`);
}
if (/captura:/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error('quedó alguna captura sin reemplazar');
html = html.replace(/\s*<!-- Este archivo es la fuente\.[\s\S]*?-->/, '');
// Nada externo: ni hojas de estilo, ni scripts, ni imágenes de otro lado.
if (/<link[^>]+stylesheet|<script[^>]+src=|<img[^>]+src="https?:/i.test(html)) throw new Error('la presentación carga algo externo');
writeFileSync(`${RAIZ}presentacion.html`, html);

const texto = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
const palabras = texto.split(/\s+/).filter(p => /[a-záéíóúñü0-9]/i.test(p)).length;
console.log(`✓ presentacion.html: ${(html.length / 1024).toFixed(0)} KB, ${Object.keys(capturas).length} capturas + 1 diagrama SVG, ${palabras} palabras`);
