// Prueba de la app en Chrome, con un Supabase simulado que devuelve los datos
// que calcula la base (PGlite). Corre con `npm run test:ui` y en el CI.
//
// Revisa que cada escritura lleve su clave, que un reintento después de un
// corte reuse la misma clave y la operación siguiente lleve otra, que los
// números escritos a mano se lean bien y que las listas pidan un orden
// estable. Un "corte" simula que la base guardó pero la respuesta no llegó.
//
// Chrome: el de NAVEGADOR si está, si no el lugar habitual en cada sistema
// (en los runners de GitHub, /usr/bin/google-chrome).
import { PGlite } from '@electric-sql/pglite';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const espera = ms => new Promise(r => setTimeout(r, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let fallas = 0;
const ok = (cond, msg) => {
  if (!cond) fallas++;
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};

const CHROME = [
  process.env.NAVEGADOR,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(r => r && existsSync(r));
if (!CHROME) {
  console.error('✗ No se encontró Chrome: indicá la ruta en la variable NAVEGADOR.');
  process.exit(1);
}

// ---------------------------------------------------------- datos reales
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
for (const f of ['01_tablas', '02_migraciones', '03_indices', '04_seguridad', '05_calculos', '06_fotos', '07_datos_muestra'])
  await db.exec(readFileSync(`${RAIZ}sql/${f}.sql`, 'utf8'));
// Como los devuelve la API de Supabase: números como números y fechas como texto.
const comoApi = filas => filas.map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => {
  if (typeof v === 'bigint') return [k, Number(v)];
  if (v instanceof Date) return [k, k === 'fecha' && f.descripcion && f.tipo_cambio ? v.toISOString().slice(0, 10) : v.toISOString()];
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return [k, Number(v)];
  return [k, v];
})));
const datos = {
  cajas_resumen: comoApi((await db.query('select * from public.cajas_resumen')).rows),
  productos_costeados: comoApi((await db.query('select * from public.productos_costeados order by nombre')).rows),
  fiados: comoApi((await db.query('select * from public.fiados')).rows),
};
await db.close();

// Reemplaza a supabase-js: anota cada llamada y, si se pide, "corta" la
// siguiente escritura (la guarda pero devuelve un error de red).
const SIMULADO = `
window.__llamadas = [];
window.__ordenes = [];
window.__cortar = 0;
window.supabase = { createClient: () => {
  const datos = ${JSON.stringify(datos)};
  const corte = () => {
    if (window.__cortar > 0) { window.__cortar--; return { data: null, error: { message: 'Failed to fetch' } }; }
    return null;
  };
  const escribir = (registro, respuesta) => { window.__llamadas.push(registro); return corte() || respuesta; };
  const consulta = tabla => {
    let op = null;
    const q = {
      select() { return q; },
      order(col, o) { window.__ordenes.push({ tabla, col, asc: !o || o.ascending !== false }); return q; },
      eq(col, val) { if (op) op.eq = [col, val]; return q; },
      upsert(p, o) { op = { tipo: 'upsert', tabla, p, o }; return q; },
      update(p) { op = { tipo: 'update', tabla, p }; return q; },
      insert(p) { op = { tipo: 'insert', tabla, p }; return q; },
      then(bien, mal) {
        const r = op
          ? escribir(op, { data: op.tipo === 'update' ? (op.eq && op.eq[1] === 'no-existe' ? [] : [{ id: op.eq && op.eq[1] }]) : null, error: null })
          : { data: datos[tabla] || [], error: null };
        return Promise.resolve(r).then(bien, mal);
      },
    };
    return q;
  };
  const subidos = new Set();
  return {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'prueba@cuenta-clara.test',
        user_metadata: { full_name: 'Usuaria de prueba' } } } } }),
      signOut: async () => ({}),
    },
    from: consulta,
    rpc: async (nombre, params) => escribir({ tipo: 'rpc', nombre, params },
      { data: nombre === 'registrar_abono' ? 100 : nombre === 'vender_producto' ? 3 : 'id-clienta', error: null }),
    storage: { from: () => ({
      getPublicUrl: () => ({ data: { publicUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' } }),
      upload: async (ruta, blob, opciones) => {
        window.__llamadas.push({ tipo: 'upload', ruta, opciones });
        if (subidos.has(ruta)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } };
        subidos.add(ruta);                         // se guarda aunque la respuesta se corte
        return corte() || { data: { path: ruta }, error: null };
      },
    }) },
  };
} };`;

// ------------------------------------------------ el sitio, servido local
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
                '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' };
const servidor = createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const archivo = join(RAIZ, ruta === '/' ? 'index.html' : ruta);
  if (!archivo.startsWith(RAIZ.replace(/[\\/]$/, '')) || !existsSync(archivo)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': (TIPOS[extname(archivo)] || 'application/octet-stream') + '; charset=utf-8' });
  res.end(readFileSync(archivo));
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const URL_APP = `http://127.0.0.1:${servidor.address().port}/app.html`;

// Una foto de 1×1 para probar la subida.
const temporal = mkdtempSync(join(tmpdir(), 'cuenta-clara-ui-'));
const FOTO = join(temporal, 'foto.png');
writeFileSync(FOTO, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: join(temporal, 'perfil'),
  // En Linux (los runners de GitHub) Chrome no puede abrir su sandbox.
  args: ['--no-first-run', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
});
const errores = [];
const respuestas = [];

try {
  const page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', r => r.url().includes('supabase-js')
    ? r.respond({ status: 200, contentType: 'application/javascript', body: SIMULADO })
    : r.continue());
  page.on('pageerror', e => errores.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept(respuestas.shift() ?? ''));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL_APP, { waitUntil: 'networkidle0' });
  await espera(800);

  const llamadas = () => page.evaluate(() => window.__llamadas);
  const de = async filtro => (await llamadas()).filter(filtro);
  const cortar = n => page.evaluate(n => { window.__cortar = n; }, n);
  const aviso = () => page.$eval('#aviso', el => el.textContent);
  const clicEn = (lista, nombre, texto) => page.evaluate((lista, nombre, texto) => {
    const card = [...document.querySelectorAll(`${lista} .tarjeta`)].find(c => c.querySelector('strong').textContent === nombre);
    [...card.querySelectorAll('button')].find(b => b.textContent.includes(texto)).click();
  }, lista, nombre, texto);
  const accion = async (lista, nombre, texto, respuesta) => {
    respuestas.push(respuesta);
    await clicEn(lista, nombre, texto);
    await espera(400);
  };
  const llenar = (form, valores) => page.evaluate((form, valores) => {
    const f = document.querySelector(form);
    for (const [k, v] of Object.entries(valores)) f.elements[k].value = v;
  }, form, valores);
  const enviar = async form => { await page.$eval(`${form} button[type="submit"]`, b => b.click()); await espera(400); };
  const mismaClave = (a, b) => UUID.test(a) && a === b;

  // ---------------------------------------------------------------- vender
  await cortar(1);
  await accion('#listaProductos', 'Labial mate surtido', 'Vender', '2');
  const avisoCorte = await aviso();
  await accion('#listaProductos', 'Labial mate surtido', 'Vender', '2');
  await accion('#listaProductos', 'Labial mate surtido', 'Vender', '2');
  const v = await de(l => l.nombre === 'vender_producto');
  ok(/conexión/i.test(avisoCorte), `el corte se avisa: "${avisoCorte}"`);
  ok(v.length === 3 && mismaClave(v[0].params.p_venta, v[1].params.p_venta),
     'vender: el reintento después del corte manda la misma clave');
  ok(v[2] && UUID.test(v[2].params.p_venta) && v[2].params.p_venta !== v[1].params.p_venta,
     'vender: la venta siguiente lleva otra clave');

  // ----------------------------------------------------------------- abono
  await cortar(1);
  await accion('#listaFiados', 'Karla Medina', 'Registrar abono', '100');
  await accion('#listaFiados', 'Karla Medina', 'Registrar abono', '100');
  await accion('#listaFiados', 'Karla Medina', 'Registrar abono', '100');
  const a = await de(l => l.nombre === 'registrar_abono');
  ok(a.length === 3 && mismaClave(a[0].params.p_abono, a[1].params.p_abono) && a[2].params.p_abono !== a[1].params.p_abono,
     'abono: el reintento reusa la clave y el siguiente lleva otra');

  // ----------------------------------------------------------------- fiado
  await llenar('#formFiado', { clienta: 'Wendy Cruz', descripcion: 'Labial', monto: '180' });
  await cortar(1);
  await enviar('#formFiado');
  await llenar('#formFiado', { clienta: '  wendy   CRUZ ', descripcion: 'Labial ', monto: '180' });
  await enviar('#formFiado');
  const fi = await de(l => l.nombre === 'registrar_fiado');
  ok(fi.length === 2 && mismaClave(fi[0].params.p_venta, fi[1].params.p_venta),
     'fiado: reintentar con el nombre escrito con otros espacios y mayúsculas reusa la clave');

  // ------------------------------------------------------------------ caja
  await llenar('#formCaja', { descripcion: 'Caja prueba', tipoCambio: '25', lote: '100' });
  await cortar(1);
  await enviar('#formCaja');
  await enviar('#formCaja');
  const c = await de(l => l.tabla === 'cajas' && l.tipo !== 'update');
  ok(c.length === 2 && c.every(x => x.tipo === 'upsert' && x.o && x.o.onConflict === 'id' && x.o.ignoreDuplicates)
     && mismaClave(c[0].p.id, c[1].p.id),
     `caja: se crea con su id y sin duplicar al reintentar (${c.map(x => x.tipo).join(', ')})`);

  // ------------------------------------------------------------------ foto
  const input = await page.$('#inpFoto');
  await cortar(1);
  await input.uploadFile(FOTO);
  await espera(1500);
  await input.uploadFile(FOTO);
  await espera(1500);
  const up = await de(l => l.tipo === 'upload');
  const vistaVisible = await page.$eval('#vistaFoto', el => el.classList.contains('visible'));
  ok(up.length === 2 && up[0].ruta === up[1].ruta && /^u1\/[0-9a-f]{64}\.jpg$/.test(up[0].ruta) && vistaVisible,
     `foto: la misma foto va a la misma ruta y el reintento la toma como subida (${up.map(u => u.ruta).join(' | ')})`);

  // -------------------------------------------------------------- producto
  await llenar('#formProducto', { nombre: 'Brocha', valorUsd: '5', cantidad: '3' });
  await cortar(1);
  await enviar('#formProducto');
  await enviar('#formProducto');
  const p = await de(l => l.tabla === 'productos' && l.tipo !== 'update');
  ok(p.length === 2 && p.every(x => x.tipo === 'upsert' && x.o && x.o.ignoreDuplicates) && mismaClave(p[0].p.id, p[1].p.id),
     `producto: se crea con su id y sin duplicar al reintentar (${p.map(x => x.tipo).join(', ')})`);
  ok(p[1] && up[0] && p[1].p.foto_path === up[0].ruta, `producto: lleva la foto subida (${p[1] && p[1].p.foto_path})`);

  // ------------------------------------------------ números escritos a mano
  await accion('#listaProductos', 'Organizador acrílico', 'Cambiar precio', '150,50');
  await accion('#listaProductos', 'Organizador acrílico', 'Cambiar precio', 'L 1,200');
  const precios = (await de(l => l.tabla === 'productos' && l.tipo === 'update')).map(x => x.p.precio);
  ok(precios.join('|') === '150.5|1200', `precio: "150,50" → 150.5 y "L 1,200" → 1200 (${precios.join(', ')})`);
  const antes = (await llamadas()).length;
  await accion('#listaProductos', 'Labial mate surtido', 'Vender', '1.5');
  await accion('#listaFiados', 'Karla Medina', 'Registrar abono', 'cien');
  const extra = (await llamadas()).slice(antes);
  ok(extra.length === 0, `vender 1.5 unidades o abonar "cien" no manda nada (${extra.map(l => l.nombre).join(', ') || 'nada'})`);

  // ------------------------------------------- cambios que no encuentran fila
  const resultado = await page.evaluate(() => Datos.cambiarPrecio('no-existe', 10).then(() => 'resolvió', e => e.message));
  ok(resultado !== 'resolvió', `cambiar el precio de un producto que no existe falla: "${resultado}"`);

  // ------------------------------------------------------------ orden estable
  const ordenes = await page.evaluate(() => window.__ordenes);
  const porTabla = t => ordenes.filter(o => o.tabla === t).map(o => o.col).slice(0, 2).join(',');
  ok(porTabla('cajas_resumen') === 'fecha,id' && porTabla('productos_costeados') === 'nombre,id' && porTabla('fiados') === 'fecha,id',
     `las lecturas desempatan por id (${['cajas_resumen', 'productos_costeados', 'fiados'].map(porTabla).join(' / ')})`);

  ok(errores.length === 0, 'errores de JS: ' + (errores.join(' | ') || 'ninguno'));
} catch (e) {
  fallas++;
  console.error('✗ FALLÓ:', e.message);
} finally {
  await browser.close();
  servidor.close();
  rmSync(temporal, { recursive: true, force: true });
}

console.log(fallas ? `\n✗ ${fallas} pruebas fallaron` : '\n✓ todas las pruebas pasaron');
process.exitCode = fallas ? 1 : 0;
