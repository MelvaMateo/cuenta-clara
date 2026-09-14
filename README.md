# Cuenta Clara

App web (PWA) para emprendedores que traen cajas desde USA y revenden: saber si cada caja les deja ganancia, a cuánto vender cada producto, quién les debe y qué se está por agotar.

Proyecto del capstone de **Ingeniería de Software I**.

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
- **Producción (planeada):** hosting en Vercel. Ver la arquitectura en [PLAN.md](PLAN.md).

## Configuración

1. Copiá la URL del proyecto y la *publishable key* (Supabase → Project Settings → API) en [js/config.js](js/config.js). Mientras queden los valores de ejemplo, el login lo avisa en pantalla en vez de fallar en silencio.
2. Creá la usuaria en **Authentication → Users → Add user**, marcando **Auto Confirm User**, o entrá una vez con Google.
3. Creá la base: Supabase → **SQL Editor** → corré en orden los scripts de [sql/](sql/), del `01` al `06`. Son idempotentes: sirven igual para una base nueva que para actualizar una que ya existe, y se pueden repetir sin romper nada. El detalle está en [sql/README.md](sql/README.md).
4. Opcional, para la demostración: `07_datos_muestra.sql` carga una caja de ejemplo en la cuenta que indiques.
5. Para revisar que todo quedó bien: `08_verificacion.sql`, que solo lee.

El acceso es por correo y contraseña. El botón de **Google** aparece solo cuando el proveedor se activa en Supabase: la app consulta qué proveedores hay antes de mostrarlo.

La *anon key* es pública por diseño: viaja al navegador en cualquier app de Supabase, y lo que protege los datos son las políticas RLS. La `service_role key` nunca va en este repo.

## Cómo probarlo

⚠️ El login con Google **no funciona abriendo el archivo con doble clic** (`file://`): OAuth exige `http(s)`. Servílo con cualquier servidor estático:

```
npx serve .
```

Abrí la dirección que imprime: esa es la landing. Desde ahí, **Iniciar sesión** te lleva al login y, tras entrar, a la app.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | Landing page: qué resuelve la app y acceso al login |
| `login.html` | Pantalla de acceso (Supabase Auth: correo y contraseña; Google si está activo) |
| `app.html` | La aplicación: cajas, stock, fiados y resumen |
| `css/base.css` | Reset, colores de la marca y botón, compartidos por las tres páginas |
| `css/landing.css`, `css/login.css`, `css/app.css` | Estilos propios de cada página |
| `js/config.js` | URL y *publishable key* del proyecto de Supabase |
| `js/sesion.js` | Abrir, leer y cerrar sesión contra Supabase Auth; lo usan el login y la app |
| `js/datos.js` | Consultas a PostgreSQL y subida de fotos a Storage |
| `js/landing.js`, `js/login.js`, `js/app.js` | Lógica de cada página (la de la landing son solo animaciones) |
| `sql/` | Scripts de la base, numerados e idempotentes: tablas, migraciones, índices, seguridad, cálculos, fotos, muestra y revisión (ver `sql/README.md`) |
| `manifest.json`, `sw.js`, `icon.svg` | Soporte PWA (instalable, offline) |
| `PLAN.md` | Plan y diseño completo: problema, backlog, arquitectura, calidad, despliegue y validación |
