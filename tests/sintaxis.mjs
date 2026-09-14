// Revisa que cada script del sitio se pueda leer: un error de sintaxis deja
// una página entera sin funcionar, y el navegador solo lo dice en la consola.
// Son scripts clásicos (no módulos), así que se revisan como tales.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const archivos = [
  ...readdirSync(`${RAIZ}js`).filter(f => f.endsWith('.js')).map(f => `js/${f}`),
  'sw.js',
];

let fallas = 0;
for (const archivo of archivos) {
  try {
    new vm.Script(readFileSync(`${RAIZ}${archivo}`, 'utf8'), { filename: archivo });
    console.log(`✓ ${archivo}`);
  } catch (e) {
    fallas++;
    console.log(`✗ ${archivo}: ${e.message}`);
  }
}
process.exitCode = fallas ? 1 : 0;
