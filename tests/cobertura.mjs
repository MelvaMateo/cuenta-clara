// Cobertura de líneas del código de la app, en formato Istanbul:
// coverage/coverage-summary.json y coverage/lcov.info. Corre con
// `npm run cobertura` y falla si queda por debajo del mínimo.
//
// El JavaScript del sitio corre en el navegador, así que su cobertura se mide
// en Chrome durante la prueba de interfaz; la del healthcheck, en Node durante
// su prueba. Las dos salen de V8, se convierten al formato de Istanbul con
// v8-to-istanbul y se suman. Los archivos de la app que ninguna prueba
// ejecuta cuentan igual, con 0 %.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import v8toIstanbul from 'v8-to-istanbul';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const MINIMO = 60;
const temporal = mkdtempSync(join(tmpdir(), 'cuenta-clara-cobertura-'));

// Rutas relativas a la raíz (js/app.js): el reporte sirve en cualquier máquina
// y SonarCloud lo encuentra. En Windows la letra del disco puede venir en
// mayúscula o minúscula, así que se compara sin distinguir.
const relativa = ruta => relative(RAIZ, ruta).split(sep).join('/');
const igual = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// El código de la app: lo que se mide.
const ARCHIVOS = [
  ...readdirSync(join(RAIZ, 'js')).filter(f => f.endsWith('.js')).map(f => join(RAIZ, 'js', f)),
  join(RAIZ, 'sw.js'),
  join(RAIZ, 'api', 'health.js'),
];

const correr = (script, env) => {
  const r = spawnSync(process.execPath, [join(RAIZ, 'tests', script)], { env: { ...process.env, ...env }, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✗ ${script} falló: sin las pruebas en verde, la cobertura no vale.`);
    process.exit(1);
  }
};

// 1. La app en Chrome, y 2. el healthcheck en Node.
const uiJson = join(temporal, 'ui.json');
const v8Dir = join(temporal, 'v8');
correr('ui.test.mjs', { COBERTURA: uiJson });
correr('health.test.mjs', { NODE_V8_COVERAGE: v8Dir });

// Cada entrada: el archivo, el texto que se ejecutó y la cobertura de V8.
const entradas = JSON.parse(readFileSync(uiJson, 'utf8')).map(e => ({
  archivo: join(RAIZ, decodeURIComponent(new URL(e.url).pathname)),
  texto: e.texto,
  funciones: e.funciones,
}));
for (const f of readdirSync(v8Dir)) {
  for (const s of JSON.parse(readFileSync(join(v8Dir, f), 'utf8')).result) {
    if (!s.url.startsWith('file:')) continue;
    const archivo = ARCHIVOS.find(a => igual(a, fileURLToPath(s.url)));
    if (archivo) entradas.push({ archivo, texto: readFileSync(archivo, 'utf8'), funciones: s.functions });
  }
}

const mapa = libCoverage.createCoverageMap({});
const agregar = async ({ archivo, texto, funciones }) => {
  const conversor = v8toIstanbul(archivo, 0, { source: texto });
  await conversor.load();
  conversor.applyCoverage(funciones);
  for (const [ruta, datos] of Object.entries(conversor.toIstanbul())) {
    const rel = relativa(ruta);
    mapa.merge({ [rel]: { ...datos, path: rel } });
  }
};
for (const e of entradas) await agregar(e);

// Lo que ninguna prueba ejecutó cuenta igual, con 0 %.
for (const archivo of ARCHIVOS) {
  if (mapa.files().includes(relativa(archivo))) continue;
  const texto = readFileSync(archivo, 'utf8');
  await agregar({
    archivo, texto,
    funciones: [{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: texto.length, count: 0 }] }],
  });
}

rmSync(join(RAIZ, 'coverage'), { recursive: true, force: true });
const contexto = libReport.createContext({ dir: join(RAIZ, 'coverage'), coverageMap: mapa, defaultSummarizer: 'flat' });
for (const reporte of ['json-summary', 'lcovonly', 'text']) reports.create(reporte).execute(contexto);
rmSync(temporal, { recursive: true, force: true });

const pct = mapa.getCoverageSummary().lines.pct;
console.log(`\n${pct >= MINIMO ? '✓' : '✗'} Cobertura de líneas: ${pct} % (mínimo ${MINIMO} %)`);
process.exitCode = pct >= MINIMO ? 0 : 1;
