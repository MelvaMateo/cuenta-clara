# Scripts de la base de datos

Se corren **en orden**, en Supabase → **SQL Editor** → *New query* → pegar → *Run*.

| # | Script | Qué hace | ¿Hace falta? |
|---|---|---|---|
| 01 | `01_tablas.sql` | Las seis tablas con su estructura final, y los textos en forma canónica | Sí |
| 02 | `02_migraciones.sql` | Lleva una base de una versión anterior a la estructura de 01. En una base nueva no hace nada | Sí |
| 03 | `03_indices.sql` | Índices para el RLS y para las claves foráneas | Sí |
| 04 | `04_seguridad.sql` | RLS: cada cuenta ve y cambia solo lo suyo | Sí |
| 05 | `05_calculos.sql` | Las vistas que calculan el costo real de cada producto, el resumen de cada caja y los saldos de los fiados, y las operaciones de la app: vender, anotar un fiado y abonar | Sí |
| 06 | `06_fotos.sql` | El bucket de fotos y quién puede listar, subir o borrar | Sí |
| 07 | `07_datos_muestra.sql` | Una caja de ejemplo en la cuenta que indiques (`v_correo`) | No |
| 08 | `08_verificacion.sql` | Revisa estructura, seguridad y datos. Solo lee | No |

## Todos son idempotentes

Se pueden correr las veces que haga falta y el resultado es el mismo:

- **01** usa `create table if not exists`: no toca una tabla que ya existe.
- **02** revisa antes de cada cambio (si una columna ya se llama así, si una restricción ya existe) y solo aplica lo que falta.
- **03** usa `create index if not exists`.
- **04**, **05** y **06** borran y vuelven a crear políticas, vistas y permisos con su definición actual; la función usa `create or replace`.
- **07** le da a cada fila de la muestra un id fijo derivado de la cuenta: correrlo de nuevo la deja igual en vez de duplicarla, y no toca nada de lo que se cargó desde la app. Si la cuenta tenía la muestra de la versión anterior del script, la reemplaza.
- **08** solo lee.

## Las operaciones de la app también son idempotentes

No solo los scripts se pueden repetir sin efecto: cada escritura de la app también. Si la conexión se corta y no se sabe si la base alcanzó a guardar, reintentar no repite nada.

- **Cada operación lleva su clave.** La app genera un id (UUID) para lo que va a crear: la venta, el fiado, el abono, la caja o el producto. Si reintenta, manda el mismo. La clave sale de qué se hace, con qué datos y sobre qué estado (por ejemplo, el stock que se veía al vender): reintentar lo mismo reusa la clave; vender otra unidad después es otra operación y lleva otra.
- **Lo que toca varias filas es una función de la base.** `vender_producto`, `registrar_fiado` y `registrar_abono` corren en una sola transacción: queda todo o nada. Con una clave ya registrada devuelven lo mismo sin repetir la operación; si la clave llega con otros datos, la rechazan. Bloquean el producto o el fiado mientras trabajan, así dos operaciones a la vez no venden de más ni abonan más de lo que se debe.
- **Crear una caja o un producto** es un `insert ... on conflict (id) do nothing` con la clave como id.
- **Cambiar un precio o el colchón** manda el valor final, no una diferencia: repetirlo deja lo mismo. Si la fila no existe, la app avisa en vez de dar el cambio por hecho.
- **Las fotos** se guardan con un nombre que sale de su contenido (SHA-256): la misma foto va siempre al mismo lugar, y resubirla no deja copias.

Y todo se guarda en una sola forma, la canónica:

- **Textos:** sin espacios al principio ni al final, uno solo entre palabras, y vacío como null. Lo hace un trigger en la base, así da igual desde dónde se cargue. "karla  medina" es la clienta Karla Medina.
- **Montos:** con dos decimales. Lo que se escribe a mano en la app ("150,50", "L 1,200") se lee siempre igual, y una cantidad tiene que ser entera: "1.5" unidades no se vende como 1.
- **Listas:** con un orden estable. Si dos cajas tienen la misma fecha, desempata el id.

## Base nueva o existente: el mismo camino

No hay un camino para instalar y otro para actualizar. En una base vacía, 01 crea todo y 02 no encuentra nada que migrar. En una base de una versión anterior, 01 no toca las tablas y 02 las lleva a la estructura actual. En los dos casos, 03 a 06 dejan índices, seguridad, vistas y fotos como deben quedar.

Si 02 encuentra datos que apuntan a otra cuenta, se detiene y avisa en vez de fallar a medias; 08 muestra cuáles son.

## Dependencias de Supabase

01 usa `auth.users` y `auth.uid()`; 04 y 05 usan los roles `authenticated` y `anon`; 06 usa el esquema `storage`. Todo eso ya existe en cualquier proyecto de Supabase.

## Cómo se probaron

Los scripts se ejecutaron en un Postgres real (PGlite) con lo mínimo de Supabase simulado, en dos escenarios: una base vacía y una copia de la base con la historia real del proyecto (esquema v1 con su muestra, luego la migración de monedas). En los dos, correr todo por segunda vez deja la estructura y los datos idénticos.

Cada operación se llamó dos veces con la misma clave (queda una sola), con la misma clave y otros datos (se rechaza sin dejar nada a medias) y con datos inválidos. La app se probó con un Supabase simulado que corta la respuesta después de guardar: el reintento manda la misma clave, y la operación siguiente, otra. Las pruebas corren en una sola conexión, así que el bloqueo entre dos operaciones simultáneas no se probó.
