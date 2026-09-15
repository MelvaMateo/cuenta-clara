// Pruebas unitarias de la lógica de la app que no depende de la pantalla ni de
// Supabase: cómo se leen los números escritos a mano, las validaciones, el
// escape de HTML, las tarjetas de producto y las claves de idempotencia.
// Corren con el test runner de Node (node:test): `npm run test:logica`.
//
// app.js y datos.js son scripts clásicos del navegador, no módulos: se cargan
// en un contexto aislado (vm) con lo mínimo del navegador simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const contexto = vm.createContext({
  window: { matchMedia: () => ({ matches: false }) },
  document: { addEventListener() {} },
  navigator: {},
  location: { protocol: 'file:' },
  crypto: globalThis.crypto,
  console,
});
for (const archivo of ['js/datos.js', 'js/app.js']) {
  vm.runInContext(readFileSync(`${RAIZ}${archivo}`, 'utf8'), contexto, { filename: archivo });
}
const deLaApp = nombre => vm.runInContext(nombre, contexto);
const leerNumero = deLaApp('leerNumero');
const leerMonto = deLaApp('leerMonto');
const leerEntero = deLaApp('leerEntero');
const esPositivo = deLaApp('esPositivo');
const esNoNegativo = deLaApp('esNoNegativo');
const esc = deLaApp('esc');
const etiquetaMargen = deLaApp('etiquetaMargen');
const Claves = deLaApp('Claves');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ------------------------------------------ números escritos a mano
test('lee "150,50" con coma decimal como 150.5', () => {
  assert.equal(leerNumero('150,50'), 150.5);
});

test('lee "L 1,200" con prefijo y separador de miles como 1200', () => {
  assert.equal(leerNumero('L 1,200'), 1200);
});

test('lee "1,500.75" con coma de miles y punto decimal', () => {
  assert.equal(leerNumero('1,500.75'), 1500.75);
});

test('devuelve NaN si el texto no es un número', () => {
  for (const texto of ['cien', '', '12abc', '-5']) assert.ok(Number.isNaN(leerNumero(texto)), texto);
});

test('redondea los montos a centavos', () => {
  assert.equal(leerMonto('10.555'), 10.56);
});

test('rechaza 1.5 unidades: una cantidad tiene que ser entera', () => {
  assert.ok(Number.isNaN(leerEntero('1.5')));
  assert.equal(leerEntero('3'), 3);
});

// ------------------------------------------------------ validaciones
test('esPositivo rechaza NaN, cero y negativos', () => {
  assert.equal(esPositivo(Number.NaN), false);
  assert.equal(esPositivo(0), false);
  assert.equal(esPositivo(-1), false);
  assert.equal(esPositivo(0.01), true);
});

test('esNoNegativo acepta cero pero no NaN', () => {
  assert.equal(esNoNegativo(0), true);
  assert.equal(esNoNegativo(Number.NaN), false);
  assert.equal(esNoNegativo(-0.01), false);
});

// ---------------------------------------------------------- pantalla
test('escapa los caracteres especiales de HTML en los nombres', () => {
  assert.equal(esc('<b>"Ana" & \'Luz\'</b>'), '&lt;b&gt;&quot;Ana&quot; &amp; &#39;Luz&#39;&lt;/b&gt;');
});

test('muestra "sin precio" cuando un producto no tiene margen', () => {
  assert.match(etiquetaMargen(null), /sin precio/);
  assert.match(etiquetaMargen(0.35), /\+35%/);
  assert.match(etiquetaMargen(-0.07), /-7%/);
});

// ------------------------------------------- claves de idempotencia
test('reusa la misma clave al reintentar después de un corte', async () => {
  const claves = [];
  const firma = ['vender', 'producto-1', 2, 8];
  await assert.rejects(Claves.con(firma, async clave => { claves.push(clave); throw new Error('Failed to fetch'); }));
  await Claves.con(firma, async clave => { claves.push(clave); });
  assert.match(claves[0], UUID);
  assert.equal(claves[1], claves[0]);
});

test('genera otra clave para la operación siguiente', async () => {
  const claves = [];
  const firma = ['vender', 'producto-2', 1, 5];
  await Claves.con(firma, async clave => { claves.push(clave); });
  await Claves.con(firma, async clave => { claves.push(clave); });
  assert.notEqual(claves[1], claves[0]);
});

test('normaliza espacios y mayúsculas en la firma de una operación', () => {
  assert.equal(Claves.texto('  Karla   MEDINA '), 'karla medina');
});
