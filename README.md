# Cuenta Clara

App web (PWA) para que un pequeño salón de belleza lleve su **inventario** y sus **fiados** sin cuaderno: saber al instante qué hay en stock, quién debe cuánto y qué deja ganancia.

Proyecto del capstone de **Ingeniería de Software I**. Cliente real y piloto: **YCC Beauty Studio** (Choloma, Cortés, Honduras).

## El problema

Yaleni, la dueña, no lleva registro de inventario ni de ganancias: solo anota en un cuaderno el nombre y la cantidad de cada fiado. No puede buscar quién le debe, no suma totales y no sabe si cada caja que importa desde USA le deja ganancia.

> *"Imaginate que no es un negocio grande, y solo le fío a pocas personas."* — Yaleni (entrevista, 6 de junio de 2026)

## Alcance del MVP (v1)

- **Inventario:** registrar productos con costo y precio (margen), ver/buscar stock, alerta de bajo stock.
- **Fiados:** registrar un fiado, ver quién debe y cuánto, registrar abonos.
- **Resumen:** total por cobrar y productos por agotarse.

Fuera de la v1: agenda de citas (ya usa otra app), reportes de margen por caja y modo offline con sincronización. El detalle está en [PLAN.md](PLAN.md).

## Tecnologías

- **PWA (este repo):** HTML, CSS y JavaScript sin compilación ni dependencias que instalar.
- **Backend:** Supabase — **Auth** para el acceso y **PostgreSQL** para el inventario, las clientas, las ventas y los fiados. Ya no queda nada en `localStorage`.
- **Producción (planeada):** hosting en Vercel. Ver la arquitectura en [PLAN.md](PLAN.md).

## Configuración

1. Copiá la URL del proyecto y la *publishable key* (Supabase → Project Settings → API) en [js/config.js](js/config.js). Mientras queden los valores de ejemplo, el login lo avisa en pantalla en vez de fallar en silencio.
2. Creá el esquema: Supabase → **SQL Editor** → pegá y ejecutá [sql/01_esquema.sql](sql/01_esquema.sql).
3. Opcional, para la demostración: ejecutá [sql/02_datos_muestra.sql](sql/02_datos_muestra.sql).
4. Creá la usuaria en **Authentication → Users → Add user**, marcando **Auto Confirm User**.

El acceso es por correo y contraseña. El botón de **Google** aparece solo cuando el proveedor se activa en Supabase: la app consulta qué proveedores hay antes de mostrarlo.

La *anon key* es pública por diseño: viaja al navegador en cualquier app de Supabase, y lo que protege los datos son las políticas RLS. La `service_role key` nunca va en este repo.

## Cómo probarlo

⚠️ El login con Google **no funciona abriendo el archivo con doble clic** (`file://`): OAuth exige `http(s)`. Servílo con cualquier servidor estático:

```
npx serve .
```

Abrí la dirección que imprime: esa es la landing. Desde ahí, **Iniciar sesión** te lleva al login con Google y, tras entrar, a la app.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | Landing page: qué resuelve la app y acceso al login |
| `login.html` | Pantalla de acceso con Google (Supabase Auth) |
| `app.html` | La aplicación: cajas, stock, fiados y resumen |
| `css/base.css` | Reset, colores de la marca y botón, compartidos por las tres páginas |
| `css/landing.css`, `css/login.css`, `css/app.css` | Estilos propios de cada página |
| `js/config.js` | URL y *publishable key* del proyecto de Supabase |
| `js/sesion.js` | Abrir, leer y cerrar sesión contra Supabase Auth; lo usan el login y la app |
| `js/datos.js` | Consultas a PostgreSQL y subida de fotos a Storage |
| `js/login.js`, `js/app.js` | Lógica de cada página |
| `sql/01_esquema.sql` | Tablas, índices, RLS, el cálculo del costo por caja y la función de venta |
| `sql/02_datos_muestra.sql` | Datos inventados para la demostración |
| `manifest.json`, `sw.js`, `icon.svg` | Soporte PWA (instalable, offline) |
| `PLAN.md` | Plan y diseño completo: problema, backlog, arquitectura, calidad, despliegue y validación |
