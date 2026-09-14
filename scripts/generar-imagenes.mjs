// Genera las imágenes del sitio a partir de icon.svg, con Chrome: los íconos
// PNG para instalar la app (Android e iOS), el favicon y la tarjeta que se ve
// al compartir el enlace (Open Graph). Se corre a mano cuando cambia el logo:
//
//   node scripts/generar-imagenes.mjs
//
// Chrome: el de NAVEGADOR si está, si no el lugar habitual en cada sistema.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
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

const logo = `data:image/svg+xml;base64,${readFileSync(`${RAIZ}icon.svg`).toString('base64')}`;
// Android e iOS recortan estos íconos con su propia forma: el degradado de la
// marca va de borde a borde, así el recorte nunca deja un borde claro.
const DEGRADADO = 'linear-gradient(135deg,#c2189f,#6a0dad)';

// Ícono cuadrado. El margen deja la zona segura: Android recorta los íconos
// "maskable" en círculo u otras formas, y el logo tiene que quedar adentro.
const icono = (lado, margen = 0, fondo = 'transparent') => {
  const logoLado = Math.round(lado * (1 - 2 * margen));
  return `<body style="margin:0;width:${lado}px;height:${lado}px;background:${fondo};display:grid;place-items:center">
    <img src="${logo}" style="width:${logoLado}px;height:${logoLado}px"></body>`;
};

// La tarjeta de 1200 × 630 que muestran WhatsApp, Facebook o LinkedIn al
// compartir el enlace.
const tarjeta = `<head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;800&display=swap">
  </head>
  <body style="margin:0;width:1200px;height:630px;box-sizing:border-box;padding:0 90px;display:flex;align-items:center;gap:64px;
               font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#b5179e,#7209b7)">
    <div style="flex:none;width:250px;height:250px;border-radius:56px;background:#fff;display:grid;place-items:center;box-shadow:0 24px 60px rgba(0,0,0,.25)">
      <img src="${logo}" style="width:190px;height:190px">
    </div>
    <div>
      <div style="font-size:88px;font-weight:800;letter-spacing:-2px;line-height:1">Cuenta Clara</div>
      <div style="font-size:44px;font-weight:800;line-height:1.15;margin-top:22px">¿Tu caja te dejó ganancia?</div>
      <div style="font-size:29px;font-weight:500;line-height:1.35;margin-top:24px;opacity:.92">El costo real de lo que traés de USA, a cuánto venderlo, tu stock y tus fiados.</div>
    </div>
  </body>`;

// Un .ico es una cabecera con una entrada por imagen, seguida de las imágenes;
// desde Windows Vista cada una puede ser un PNG.
const ico = imagenes => {
  const cabecera = Buffer.alloc(6 + 16 * imagenes.length);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);                     // 1 = ícono
  cabecera.writeUInt16LE(imagenes.length, 4);
  let desde = cabecera.length;
  imagenes.forEach(({ lado, datos }, i) => {
    const e = 6 + 16 * i;
    cabecera.writeUInt8(lado, e);
    cabecera.writeUInt8(lado, e + 1);
    cabecera.writeUInt16LE(1, e + 4);               // planos
    cabecera.writeUInt16LE(32, e + 6);              // bits por pixel
    cabecera.writeUInt32LE(datos.length, e + 8);
    cabecera.writeUInt32LE(desde, e + 12);
    desde += datos.length;
  });
  return Buffer.concat([cabecera, ...imagenes.map(i => i.datos)]);
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: process.platform === 'linux' ? ['--no-sandbox'] : [],
});
const page = await browser.newPage();
const png = async (html, ancho, alto = ancho) => {
  await page.setViewport({ width: ancho, height: alto, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  // El logo y las fuentes tienen que estar listos antes de sacar la foto.
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode())]));
  return Buffer.from(await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: ancho, height: alto } }));
};

mkdirSync(`${RAIZ}img`, { recursive: true });
const salidas = {
  'img/icon-192.png': await png(icono(192, 0.04), 192),
  'img/icon-512.png': await png(icono(512, 0.04), 512),
  'img/icon-maskable-512.png': await png(icono(512, 0.2, DEGRADADO), 512),
  // iOS no admite transparencia: sin fondo, el ícono quedaría sobre negro.
  'apple-touch-icon.png': await png(icono(180, 0.1, DEGRADADO), 180),
  'favicon.ico': ico([
    { lado: 16, datos: await png(icono(16), 16) },
    { lado: 32, datos: await png(icono(32), 32) },
  ]),
  'img/og.png': await png(tarjeta, 1200, 630),
};
await browser.close();

for (const [ruta, datos] of Object.entries(salidas)) {
  writeFileSync(`${RAIZ}${ruta}`, datos);
  console.log(`✓ ${ruta} (${(datos.length / 1024).toFixed(1)} KB)`);
}
