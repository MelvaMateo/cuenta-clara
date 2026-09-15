// Pruebas de los scripts de sql/ en un Postgres real (PGlite), con lo mínimo
// de Supabase simulado. Corren con `npm run test:sql` y en el CI.
//
//   A) base vacía: 01→08 y todo otra vez (idempotencia), integridad y permisos
//   B) la historia real de la base: esquema v1 con su muestra → migración de
//      monedas → scripts actuales; ningún número puede cambiar
//   C) textos canónicos
//   D) operaciones idempotentes: vender, fiar y abonar
//   E) la revisión (08) corre aunque la base sea de una versión anterior
//
// Los escenarios de migración usan los scripts viejos sacados del historial de
// git, así que hace falta el historial completo (en el CI: fetch-depth: 0).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = f => readFileSync(`${RAIZ}sql/${f}`, 'utf8');
const deGit = (rev, f) => {
  try {
    return execFileSync('git', ['show', `${rev}:sql/${f}`], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error(`No se encontró sql/${f} en ${rev}: hace falta el historial completo de git (fetch-depth: 0).`);
  }
};
const BASE = ['01_tablas.sql', '02_migraciones.sql', '03_indices.sql', '04_seguridad.sql', '05_calculos.sql', '06_fotos.sql'];
const TABLAS = ['cajas', 'productos', 'clientas', 'ventas', 'detalle_venta', 'abonos'];

// Lo mínimo de Supabase: auth.users, auth.uid() (se fija con prueba.uid), los
// roles y el esquema de Storage.
const SUPABASE = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon;          exception when duplicate_object then null; end $$;
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable
    as $$ select string_to_array(name, '/') $$;
  insert into auth.users (email) values ('odany_m@unitec.edu');
`;

let fallas = 0;
const ok = (cond, msg) => {
  if (!cond) fallas++;
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
};
const nueva = async () => { const db = new PGlite(); await db.exec(SUPABASE); return db; };
const filas = async (db, sql) => (await db.query(sql)).rows;
const correr = async (db, nombre, sql) => {
  try { await db.exec(sql); }
  catch (e) { console.error(`\n✗ FALLÓ ${nombre}: ${e.message}`); process.exit(1); }
};
const todo = async (db, muestra = true) => {
  for (const f of BASE) await correr(db, f, leer(f));
  if (muestra) await correr(db, '07_datos_muestra.sql', leer('07_datos_muestra.sql'));
};
const foto = async db => {
  const j = async sql => JSON.stringify(await filas(db, sql));
  let datos = '';
  for (const t of TABLAS) datos += await j(`select * from public.${t} order by id`);
  const esquema =
      await j(`select table_name, column_name, data_type, column_default, is_nullable
                 from information_schema.columns where table_schema = 'public' order by 1, 2`)
    + await j(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid)
                 from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)
    + await j(`select indexname, indexdef from pg_indexes where schemaname = 'public' order by 1`)
    + await j(`select schemaname, tablename, policyname, cmd, roles::text, qual, with_check
                 from pg_policies order by 1, 2, 3`)
    + await j(`select viewname, definition from pg_views where schemaname = 'public' order by 1`);
  return { datos, esquema };
};
const numeros = db => filas(db, `select descripcion, invertido, factor, parte_usd, vendido, falta_recuperar,
                                        ganancia_proyectada from public.cajas_resumen order by descripcion`);
const costeo = db => filas(db, `select nombre, costo_unitario, precio_sugerido from public.productos_costeados order by nombre`);
const cuentas = async db => Object.fromEntries(await Promise.all([
  ['cajas', 'select count(*)::int n from public.cajas'],
  ['productos', 'select count(*)::int n from public.productos'],
  ['clientas', 'select count(*)::int n from public.clientas'],
  ['contado', 'select count(*)::int n from public.ventas where not es_fiada'],
  ['fiados', 'select count(*)::int n from public.ventas where es_fiada'],
  ['detalle', 'select count(*)::int n from public.detalle_venta'],
  ['abonos', 'select count(*)::int n from public.abonos'],
].map(async ([k, q]) => [k, (await filas(db, q))[0].n])));
const MUESTRA = JSON.stringify({ cajas: 1, productos: 8, clientas: 3, contado: 4, fiados: 3, detalle: 5, abonos: 3 });
const informe = async db => {
  const r = await filas(db, leer('08_verificacion.sql'));
  return { r, malos: r.filter(x => x.estado === '❌') };
};
// La base con la historia real: esquema v1 con su muestra, y la migración de monedas.
const historiaReal = async db => {
  await correr(db, 'v1 01_esquema (d1b938b)', deGit('d1b938b', '01_esquema.sql'));
  await correr(db, 'v1 02_datos_muestra (d1b938b)', deGit('d1b938b', '02_datos_muestra.sql'));
  await correr(db, 'v2 03_monedas_y_colchon (d60e9bb)', deGit('d60e9bb', '03_monedas_y_colchon.sql'));
  await correr(db, 'v2 01_esquema (d60e9bb)', deGit('d60e9bb', '01_esquema.sql'));
};

// ======================================================================= A
console.log('━━━ A) Base vacía ━━━');
{
  const db = await nueva();
  await todo(db);
  const f1 = await foto(db);
  await todo(db);
  const f2 = await foto(db);
  ok(f1.esquema === f2.esquema, 'correr todo dos veces deja la estructura idéntica');
  ok(f1.datos === f2.datos, 'correr todo dos veces deja los datos idénticos');
  ok(JSON.stringify(await cuentas(db)) === MUESTRA, 'la muestra no se duplica: ' + JSON.stringify(await cuentas(db)));

  // Lo cargado desde la app no se toca al volver a correr la muestra.
  const [{ id: yo }] = await filas(db, `select id from auth.users where email = 'odany_m@unitec.edu'`);
  await db.exec(`insert into public.cajas (owner_id, descripcion, tipo_cambio) values ('${yo}', 'Mi caja real', 25)`);
  await correr(db, '07 otra vez', leer('07_datos_muestra.sql'));
  ok((await filas(db, `select 1 from public.cajas where descripcion = 'Mi caja real'`)).length === 1,
     'volver a correr la muestra no toca una caja cargada desde la app');

  // Integridad: nada puede apuntar a datos de otra cuenta.
  await db.exec(`insert into auth.users (email) values ('otra@correo.hn')`);
  const [{ id: otra }] = await filas(db, `select id from auth.users where email = 'otra@correo.hn'`);
  const [{ id: caja }] = await filas(db, `select id from public.cajas where descripcion = 'Caja agosto 2026'`);
  const [{ id: fiado }] = await filas(db, `select id from public.ventas where es_fiada limit 1`);
  const rechaza = async (sql, msg) => {
    try { await db.exec(sql); ok(false, msg + ' (lo aceptó)'); }
    catch { ok(true, msg); }
  };
  await rechaza(`insert into public.productos (owner_id, caja_id, nombre, origen, valor_usd, cantidad, stock)
                 values ('${otra}', '${caja}', 'intruso', 'lote', 1, 1, 1)`, 'rechaza un producto en la caja de otra cuenta');
  await rechaza(`insert into public.abonos (owner_id, venta_id, monto) values ('${otra}', '${fiado}', 1)`,
                'rechaza un abono al fiado de otra cuenta');

  // Borrados en cascada con las referencias del mismo dueño.
  const [{ n: detAntes }] = await filas(db, `select count(*)::int n from public.detalle_venta where producto_id is not null`);
  await db.exec(`delete from public.productos where nombre = 'Cepillo desenredante'`);
  const [{ n: detDespues }] = await filas(db, `select count(*)::int n from public.detalle_venta where producto_id is not null`);
  const [{ n: detTotal }] = await filas(db, `select count(*)::int n from public.detalle_venta`);
  ok(detDespues === detAntes - 1 && detTotal === 5, 'borrar un producto deja su venta en el historial, sin el producto');

  // Permisos.
  const [{ puede }] = await filas(db, `select has_function_privilege('anon', 'public.vender_producto(uuid,uuid,integer)', 'execute') as puede`);
  ok(!puede, 'anon no puede usar vender_producto');
  const [{ sel }] = await filas(db, `select has_table_privilege('anon', 'public.cajas', 'select') as sel`);
  ok(!sel, 'anon no tiene permisos sobre las tablas');
  const [{ auth }] = await filas(db, `select has_table_privilege('authenticated', 'public.cajas_resumen', 'select') as auth`);
  ok(auth, 'authenticated puede leer las vistas');

  const { malos } = await informe(db);
  ok(malos.length === 0, `08_verificacion: ${malos.length} revisiones con ❌`);
}

// ======================================================================= B
console.log('\n━━━ B) La base con su historia real ━━━');
{
  const db = await nueva();
  await historiaReal(db);
  const antes = JSON.stringify([await numeros(db), await costeo(db)]);

  await todo(db, false);
  ok(JSON.stringify([await numeros(db), await costeo(db)]) === antes,
     'actualizar a los scripts actuales no cambia ningún número de la base existente');

  await correr(db, '07_datos_muestra.sql', leer('07_datos_muestra.sql'));
  ok(JSON.stringify(await cuentas(db)) === MUESTRA,
     'la muestra vieja se reemplaza, sin duplicados: ' + JSON.stringify(await cuentas(db)));

  const f1 = await foto(db);
  await todo(db);
  const f2 = await foto(db);
  ok(f1.esquema === f2.esquema && f1.datos === f2.datos, 'correr todo otra vez no cambia nada');

  const { malos } = await informe(db);
  ok(malos.length === 0, `08_verificacion sobre la base migrada: ${malos.length} revisiones con ❌`);
}

// ======================================================================= C
console.log('\n━━━ C) Textos canónicos ━━━');
{
  const db = await nueva();
  await todo(db);
  const [{ id: yo }] = await filas(db, `select id from auth.users where email = 'odany_m@unitec.edu'`);
  await db.exec(`insert into public.clientas (owner_id, nombre, telefono) values ('${yo}', '  Ana   María\tLópez ', '  ')`);
  const [ana] = await filas(db, `select nombre, telefono from public.clientas where lower(nombre) like 'ana%'`);
  ok(ana.nombre === 'Ana María López' && ana.telefono === null, `se guarda canónico: ${JSON.stringify(ana)}`);
  try {
    await db.exec(`insert into public.clientas (owner_id, nombre) values ('${yo}', 'ana maría  lópez')`);
    ok(false, 'aceptó una clienta repetida escrita con otros espacios');
  } catch { ok(true, 'rechaza la misma clienta escrita con otras mayúsculas y espacios'); }
  await db.exec(`update public.productos set nombre = ' Labial   mate surtido ' where nombre = 'Labial mate surtido'`);
  ok((await filas(db, `select 1 from public.productos where nombre = 'Labial mate surtido'`)).length === 1,
     'también al actualizar');
  const { malos } = await informe(db);
  ok(malos.length === 0, `08: ${malos.length} revisiones con ❌`);
}
{
  // Una base de una versión anterior con textos desordenados: 02 los normaliza…
  const db = await nueva();
  await correr(db, 'v1 01', deGit('d1b938b', '01_esquema.sql'));
  await correr(db, 'v1 02', deGit('d1b938b', '02_datos_muestra.sql'));
  await db.exec(`update public.productos set nombre = nombre || '  ' where nombre like 'Labial%'`);
  await db.exec(`update public.ventas set descripcion = '' where es_fiada and total = 850`);
  await todo(db, false);
  ok((await filas(db, `select 1 from public.productos where nombre = 'Labial mate surtido'`)).length === 1
     && (await filas(db, `select 1 from public.ventas where total = 850 and descripcion is null`)).length === 1,
     '02 normaliza los textos de una base existente');
}
{
  // …y si al normalizar quedarían dos clientas iguales, avisa en vez de fallar a medias.
  const db = await nueva();
  await correr(db, 'v1 01', deGit('d1b938b', '01_esquema.sql'));
  await correr(db, 'v1 02', deGit('d1b938b', '02_datos_muestra.sql'));
  const [{ id: yo }] = await filas(db, `select id from auth.users limit 1`);
  await db.exec(`insert into public.clientas (owner_id, nombre) values ('${yo}', 'Karla  Medina')`);
  let msg = '';
  for (const f of BASE) { try { await db.exec(leer(f)); } catch (e) { msg = e.message; break; } }
  ok(/clientas repetidas: Karla Medina/.test(msg), `avisa las clientas repetidas: ${msg}`);
}

// ======================================================================= D
console.log('\n━━━ D) Operaciones idempotentes ━━━');
{
  const db = await nueva();
  await todo(db);
  const uno = async sql => (await filas(db, sql))[0];
  const falla = async (sql, patron, msg) => {
    try { await db.query(sql); ok(false, msg + ' (no falló)'); }
    catch (e) { ok(patron.test(e.message), `${msg}: ${e.message}`); }
  };
  const nuevoId = async () => (await uno(`select gen_random_uuid() as id`)).id;

  // ---- vender
  const { id: labial, stock: s0 } = await uno(`select id, stock from public.productos where nombre = 'Labial mate surtido'`);
  const cVenta = await nuevoId();
  const vender = (clave, prod, n) => uno(`select public.vender_producto('${clave}', '${prod}', ${n}) as s`);
  const r1 = await vender(cVenta, labial, 2);
  const r2 = await vender(cVenta, labial, 2);
  const ventas = await uno(`select count(*)::int n from public.ventas where id = '${cVenta}'`);
  ok(r1.s === s0 - 2 && r2.s === s0 - 2 && ventas.n === 1,
     `vender dos veces con la misma clave descuenta una vez (stock ${s0} → ${r1.s} → ${r2.s}, ventas ${ventas.n})`);
  await falla(`select public.vender_producto('${cVenta}', '${labial}', 1)`, /otros datos/, 'la misma clave con otra cantidad se rechaza');
  await falla(`select public.vender_producto('${await nuevoId()}', '${labial}', 999)`, /suficiente stock/, 'no deja vender de más');
  await falla(`select public.vender_producto(null, '${labial}', 1)`, /clave/, 'sin clave no vende');
  ok((await uno(`select to_regprocedure('public.vender_producto(uuid,integer)') is null as sin`)).sin,
     'la versión sin clave ya no existe');

  // ---- fiado
  const { id: yo } = await uno(`select id from auth.users where email = 'odany_m@unitec.edu'`);
  await falla(`select public.registrar_fiado(gen_random_uuid(), 'Ana', null, 10)`, /sesión/, 'sin sesión no fía');
  await db.exec(`select set_config('prueba.uid', '${yo}', false)`);
  const cuenta = async () => uno(`select (select count(*)::int from public.clientas) c,
                                         (select count(*)::int from public.ventas where es_fiada) f`);
  const antes = await cuenta();
  const cFiado = await nuevoId();
  const fiar = (clave, cli, desc, total) =>
    uno(`select public.registrar_fiado('${clave}', '${cli}', ${desc === null ? 'null' : `'${desc}'`}, ${total}) as cli`);
  const f1 = await fiar(cFiado, '  karla   MEDINA ', ' Paleta  18 tonos ', 520);
  const f2 = await fiar(cFiado, '  karla   MEDINA ', ' Paleta  18 tonos ', 520);
  const despues = await cuenta();
  const { id: karla } = await uno(`select id from public.clientas where nombre = 'Karla Medina'`);
  ok(f1.cli === karla && f2.cli === karla && despues.c === antes.c && despues.f === antes.f + 1,
     `fiar dos veces con la misma clave anota uno, a la clienta que ya existía (clientas ${antes.c} → ${despues.c}, fiados ${antes.f} → ${despues.f})`);
  ok((await uno(`select descripcion from public.ventas where id = '${cFiado}'`)).descripcion === 'Paleta 18 tonos',
     'la descripción queda canónica');
  await falla(`select public.registrar_fiado('${cFiado}', 'Karla Medina', 'Paleta 18 tonos', 600)`, /otros datos/,
              'la misma clave con otro monto se rechaza');
  await falla(`select public.registrar_fiado('${await nuevoId()}', 'Clienta Nueva', null, 0)`, /mayor que cero/,
              'un fiado en cero se rechaza');
  ok((await cuenta()).c === antes.c, 'lo rechazado no deja clientas sueltas');
  await fiar(await nuevoId(), 'Ana_María', null, 100);
  ok((await uno(`select count(*)::int n from public.clientas where nombre = 'Ana_María'`)).n === 1,
     'un nombre con _ no se confunde con otro');
  await db.exec(`select set_config('prueba.uid', '', false)`);

  // ---- abono
  const { id: fKarla } = await uno(`select id from public.fiados where clienta = 'Karla Medina' and total = 850`);
  const cAbono = await nuevoId();
  const abonar = (clave, venta, monto) => uno(`select public.registrar_abono('${clave}', '${venta}', ${monto}) as s`);
  const nAbonos = async () => (await uno(`select count(*)::int n from public.abonos where venta_id = '${fKarla}'`)).n;
  const a0 = await nAbonos();
  const s1 = await abonar(cAbono, fKarla, 100);
  const s2 = await abonar(cAbono, fKarla, 100);
  const saldo = await uno(`select saldo from public.fiados where id = '${fKarla}'`);
  ok(Number(s1.s) === 450 && Number(s2.s) === 450 && (await nAbonos()) === a0 + 1 && Number(saldo.saldo) === 450,
     `abonar dos veces con la misma clave suma una vez (saldo 550 → ${s1.s} → ${s2.s})`);
  await falla(`select public.registrar_abono('${cAbono}', '${fKarla}', 50)`, /otros datos/, 'la misma clave con otro monto se rechaza');
  await falla(`select public.registrar_abono('${await nuevoId()}', '${fKarla}', 451)`, /mayor que el saldo/, 'no deja abonar más de lo que se debe');
  const { id: contado } = await uno(`select id from public.ventas where not es_fiada limit 1`);
  await falla(`select public.registrar_abono('${await nuevoId()}', '${contado}', 10)`, /No existe el fiado/, 'no deja abonar a una venta de contado');
  const s3 = await abonar(await nuevoId(), fKarla, 450);
  ok(Number(s3.s) === 0, 'el último abono deja el saldo en cero');

  const { malos } = await informe(db);
  ok(malos.length === 0, `08: ${malos.length} revisiones con ❌`);
}

// ======================================================================= E
console.log('\n━━━ E) La revisión sobre una base de la versión anterior ━━━');
{
  // Los scripts como estaban antes de las operaciones idempotentes (2934947).
  const db = await nueva();
  for (const f of [...BASE, '07_datos_muestra.sql']) await correr(db, `${f} (2934947)`, deGit('2934947', f));
  let r = null;
  try { ({ r } = await informe(db)); } catch (e) { ok(false, `el 08 falla sobre la base vieja: ${e.message}`); }
  if (r) {
    const malos = r.filter(x => x.estado === '❌').map(x => x.revision).sort().join(' | ');
    ok(malos === 'Operaciones con clave, solo con sesión | Textos en forma canónica',
       `el 08 corre y marca lo que falta: ${malos}`);
  }
}

// ======================================================================= F
console.log('\n━━━ F) Exportar el modelo de datos (09) ━━━');
{
  const db = await nueva();
  await todo(db);
  const exportar = async () => {
    const e = (await db.exec(leer('09_exportar_esquema.sql'))).at(-1).rows[0].export;
    return typeof e === 'string' ? JSON.parse(e) : e;
  };
  const exp = await exportar();
  ok(exp.motor === 'postgres' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(exp.generado_at)
     && Math.abs(Date.parse(exp.generado_at) - Date.now()) < 5 * 60 * 1000,
     `cabecera: motor postgres y generado_at de ahora (${exp.generado_at})`);
  ok(JSON.stringify(Object.keys(exp)) === '["generado_at","motor","tablas"]'
     && exp.tablas.every(t => JSON.stringify(Object.keys(t)) === '["nombre","filas","columnas","indices","relaciones","politicas_rls"]')
     && exp.tablas.every(t => t.columnas.every(c => JSON.stringify(Object.keys(c)) === '["nombre","tipo","pk","nulo"]')),
     'las claves son exactamente las del formato pedido');
  ok(JSON.stringify(exp.tablas.map(t => t.nombre)) === JSON.stringify([...TABLAS].sort()),
     `exporta las 6 tablas: ${exp.tablas.map(t => t.nombre).join(', ')}`);
  ok(exp.tablas.every(t => t.columnas.some(c => c.nombre === 'id' && c.pk && !c.nulo && c.tipo === 'uuid')),
     'todas tienen llave primaria (id uuid)');
  const relaciones = exp.tablas.flatMap(t => t.relaciones);
  ok(relaciones.length === 5 && relaciones.every(r => TABLAS.includes(r.referencia.split('.')[0])),
     `5 relaciones entre tablas: ${relaciones.map(r => r.columna + '→' + r.referencia).join(', ')}`);
  ok(exp.tablas.every(t => t.indices.length > 0 && t.politicas_rls.includes('solo lo propio')),
     'cada tabla con índices y la política "solo lo propio"');
  const conteo = {};
  for (const t of TABLAS) conteo[t] = (await filas(db, `select count(*)::int n from public.${t}`))[0].n;
  ok(exp.tablas.every(t => t.filas === conteo[t.nombre]),
     `las filas coinciden con la base: ${exp.tablas.map(t => `${t.nombre} ${t.filas}`).join(', ')}`);
  const otra = await exportar();
  ok(JSON.stringify({ ...otra, generado_at: '' }) === JSON.stringify({ ...exp, generado_at: '' }),
     'correrlo otra vez da lo mismo (solo cambia la fecha)');
}

console.log(fallas ? `\n✗ ${fallas} pruebas fallaron` : '\n✓ todas las pruebas pasaron');
process.exitCode = fallas ? 1 : 0;
