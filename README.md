# Cuenta Clara

[![CI](https://github.com/MelvaMateo/cuenta-clara/actions/workflows/ci.yml/badge.svg)](https://github.com/MelvaMateo/cuenta-clara/actions/workflows/ci.yml) [![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=MelvaMateo_cuenta-clara&metric=alert_status)](https://sonarcloud.io/summary/overall?id=MelvaMateo_cuenta-clara)

App web (PWA) para emprendedores que traen cajas desde USA y revenden: saber si cada caja les deja ganancia, a cuánto vender cada producto, quién les debe y qué se está por agotar.

Proyecto del capstone de **Ingeniería de Software I**.

**Código de verificación:** `LEARN-CAP-FE4FE1D4`

## El problema

Quien trae mercadería desde USA suele ponerle precio a ojo, sin sumar lo que costó traerla: el flete, la aduana y lo que se pagó por el lote. Así no hay forma de saber si una caja dejó ganancia, y es fácil vender con pérdida sin enterarse.

## Qué hace

- **Cajas:** se registra lo que costó la caja (lote, compras en tienda, flete, aduana y otros gastos, cada uno en la moneda en que se pagó) y el tipo de cambio al que se pagó, que queda fijo con la caja. La app reparte ese costo entre los productos, dice cuánto encarece traer la mercadería y cuánto falta vender para recuperar la inversión.
- **Precio con ganancia:** al cargar un producto muestra su costo real en lempiras y el precio sugerido para el margen elegido, más un colchón por si sube el dólar que se ajusta por caja, y avisa si un precio queda por debajo del costo.
- **Stock con alerta:** cada producto con foto tomada desde el celular, y aviso cuando está por agotarse.
- **Fiados:** quién debe, cuánto, y sus abonos.

Lo comprado en tiendas conserva su costo exacto; lo que llega en lotes surtidos sin precios se reparte según el valor estimado de cada cosa, anclado siempre a lo que de verdad se pagó. El diseño completo está en [PLAN.md](PLAN.md).

## Tecnologías

- **PWA (este repo):** HTML, CSS y JavaScript sin compilación ni dependencias que instalar.
- **Backend:** Supabase — **Auth** para el acceso y **PostgreSQL** para el inventario, las clientas, las ventas y los fiados. Ya no queda nada en `localStorage`.
- **Producción:** Vercel, en https://www.melvamateo.site (ver "Publicación"). La arquitectura está en [docs/arquitectura.md](docs/arquitectura.md), con los diagramas C4 y las decisiones (ADRs); el plan inicial, en [PLAN.md](PLAN.md).

## Configuración

1. Copiá la URL del proyecto y su clave pública (Supabase → Project Settings → API) en [js/config.js](js/config.js). Mientras queden los valores de ejemplo, el login lo avisa en pantalla en vez de fallar en silencio.
2. Creá la usuaria en **Authentication → Users → Add user**, marcando **Auto Confirm User**, o entrá una vez con Google.
3. Creá la base: Supabase → **SQL Editor** → corré en orden los scripts de [sql/](sql/), del `01` al `06`. Son idempotentes: sirven igual para una base nueva que para actualizar una que ya existe, y se pueden repetir sin romper nada. El detalle está en [sql/README.md](sql/README.md).
4. Opcional, para la demostración: `07_datos_muestra.sql` carga una caja de ejemplo en la cuenta que indiques.
5. Para revisar que todo quedó bien: `08_verificacion.sql`, que solo lee.

El acceso es por correo y contraseña. El botón de **Google** aparece solo cuando el proveedor se activa en Supabase: la app consulta qué proveedores hay antes de mostrarlo.

La clave pública de Supabase es pública por diseño: viaja al navegador en cualquier app de Supabase, y lo que protege los datos son las políticas RLS. La clave de administrador del proyecto, que se salta esas políticas, nunca va en este repo.

## Cómo probarlo

⚠️ El login con Google **no funciona abriendo el archivo con doble clic** (`file://`): OAuth exige `http(s)`. Servílo con cualquier servidor estático:

```
npx serve .
```

Abrí la dirección que imprime: esa es la landing. Desde ahí, **Iniciar sesión** te lleva al login y, tras entrar, a la app.

## Publicación

El sitio se publica en Vercel (ver "Pruebas y CI/CD"). Sus direcciones:

| Qué | Dirección |
|---|---|
| Sitio | https://www.melvamateo.site/ |
| Login | https://www.melvamateo.site/login.html |
| Portal privado (requiere sesión) | https://www.melvamateo.site/app.html |
| Healthcheck (JSON) | https://www.melvamateo.site/api/health |
| Presentación del producto | https://www.melvamateo.site/presentacion.html |

- **Instalable (PWA):** manifest con íconos PNG de 192 y 512 (y uno *maskable* para Android), ícono para iPhone y un service worker que deja abrir la app sin internet. Las imágenes salen de `icon.svg` con `node scripts/generar-imagenes.mjs`.
- **Buscadores y redes:** título, descripción, Open Graph con la tarjeta `img/og.png`, y `robots.txt`, que deja afuera la app privada.
- **Seguridad:** `vercel.json` manda un Content-Security-Policy que solo deja cargar lo que el sitio usa, más HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y la prohibición de meter el sitio en un iframe.
- **Portal privado:** sin sesión, el servidor no entrega `app.html`: una cookie (`cc_sesion`) marca que en ese navegador hay sesión, y sin ella Vercel redirige al login (`redirects` en `vercel.json`). Esa cookie es solo un aviso, no la sesión: si hay marca pero la sesión venció, la app la borra, no muestra nada y manda al login. Los datos nunca salen de la base sin sesión: los protege el RLS.
- **Healthcheck:** `/api/health` responde en JSON si el sitio y Supabase están disponibles: 200 con `"status": "ok"`, o 503 con `"degraded"` y el motivo si Supabase no responde.
- **404:** una dirección que no existe muestra `404.html`, con el diseño del sitio.

## Pruebas y CI/CD

Las pruebas no forman parte del sitio: el sitio es estático y se publica sin instalar nada. Para correrlas hace falta Node 20 o más:

```bash
npm ci      # instala las herramientas de prueba
npm test    # corre las cinco, en este orden
```

| Comando | Qué prueba |
|---|---|
| `npm run test:sintaxis` | Que cada script de `js/` y el service worker se puedan leer |
| `npm run test:logica` | Pruebas unitarias con el test runner de Node (`node:test`), en `tests/logica.test.mjs`: cómo se leen los números escritos a mano, las validaciones, el escape de HTML y las claves de idempotencia |
| `npm run test:health` | El healthcheck, sin red: 200 si Supabase responde, 503 si no, siempre en JSON |
| `npm run test:sql` | Los scripts de `sql/` en un Postgres real (PGlite): que se puedan repetir, que actualicen una base con la historia real sin cambiar ningún número, los textos canónicos y las operaciones con clave |
| `npm run test:ui` | La app en Chrome, con Supabase simulado: que un reintento después de un corte no repita la operación, los números escritos a mano y el orden de las listas. Si Chrome no está en su lugar habitual, poné la ruta en la variable `NAVEGADOR` |
| `npm run cobertura` | Corre la prueba de interfaz y la del healthcheck midiendo qué líneas ejecutan, y escribe `coverage/coverage-summary.json` y `coverage/lcov.info` (formato Istanbul). Falla si baja de 60 % |

**Calidad de código.** La cobertura de líneas es de **78.66 %**: el JavaScript del sitio se mide en Chrome durante la prueba de interfaz, y el healthcheck en Node. Los archivos que ninguna prueba ejecuta, como el service worker, cuentan igual, con 0 %. SonarCloud analiza el código en cada push a `main` ([resultados](https://sonarcloud.io/summary/overall?id=MelvaMateo_cuenta-clara)); `.sonarcloud.properties` dice qué analiza y por qué `sql/` queda afuera.

**CI (integración continua).** GitHub Actions corre esas cinco pruebas en cada push y en cada pull request ([.github/workflows/ci.yml](.github/workflows/ci.yml)). Si alguna falla, el commit o el PR queda con una ❌ en GitHub; la insignia de arriba muestra cómo quedó el último.

**CD.** Vercel está conectado al repo: cada push a `main` se publica solo en https://www.melvamateo.site, y cada rama o PR recibe una URL de vista previa. Eso es *despliegue* continuo (lo nuevo llega a producción sin que nadie apriete un botón), que va un paso más allá de la *entrega* continua (lo nuevo queda listo para publicar, pero alguien decide cuándo).

Solo llega a producción lo que pasó el CI:

- **En Vercel**, el proyecto exige el check `test` de GitHub (*Deployment Checks*): cada push se construye, pero no pasa a producción hasta que las pruebas están en verde. Si fallan, el sitio sigue mostrando la versión anterior.
- **En GitHub**, `main` está protegida: un PR no se puede unir sin el check `test` en verde, y la rama no se puede reescribir con force push ni borrar.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | Landing page: qué resuelve la app y acceso al login |
| `login.html` | Pantalla de acceso (Supabase Auth: correo y contraseña; Google si está activo) |
| `app.html` | La aplicación: cajas, stock, fiados y resumen |
| `css/base.css` | Reset, colores de la marca y botón, compartidos por las tres páginas |
| `css/landing.css`, `css/login.css`, `css/app.css` | Estilos propios de cada página |
| `js/config.js` | URL y clave pública del proyecto de Supabase |
| `js/sesion.js` | Abrir, leer y cerrar sesión contra Supabase Auth; lo usan el login y la app |
| `js/datos.js` | Consultas a PostgreSQL y subida de fotos a Storage. Cada escritura lleva su clave, así un reintento no la repite (ver `sql/README.md`) |
| `js/landing.js`, `js/login.js`, `js/app.js` | Lógica de cada página (la de la landing son solo animaciones) |
| `sql/` | Scripts de la base, numerados e idempotentes: tablas, migraciones, índices, seguridad, cálculos, fotos, muestra y revisión (ver `sql/README.md`) |
| `tests/`, `package.json` | Las pruebas y sus herramientas; el sitio no las necesita (ver "Pruebas y CI/CD") |
| `.github/workflows/ci.yml` | El pipeline de CI en GitHub Actions |
| `coverage/` | El reporte de cobertura (Istanbul): `coverage-summary.json` y `lcov.info` |
| `.sonarcloud.properties` | Qué analiza SonarCloud y qué deja afuera |
| `manifest.json`, `sw.js`, `icon.svg` | Soporte PWA (instalable, offline) |
| `img/`, `favicon.ico`, `apple-touch-icon.png` | Íconos para instalar la app y la tarjeta para compartir; se generan con `scripts/generar-imagenes.mjs` |
| `404.html`, `robots.txt` | La página de "no existe" y las reglas para buscadores |
| `presentacion.html` | La presentación del producto en un solo archivo, con las capturas embebidas. Se genera con `node scripts/generar-presentacion.mjs` a partir de `docs/presentacion-fuente.html` |
| `vercel.json` | Headers de seguridad y la configuración del healthcheck |
| `api/health.js` | El healthcheck: `GET /api/health` |
| `PLAN.md` | Plan y diseño completo: problema, backlog, arquitectura, calidad, despliegue y validación |
| `docs/arquitectura.md` | Arquitectura actual: diagramas C4 (contexto y contenedores), despliegue y atributos de calidad |
| `docs/adr/` | Decisiones de arquitectura (ADRs), con contexto, decisión y consecuencias |
