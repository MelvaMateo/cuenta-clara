# Scripts de la base de datos

Se corren **en orden**, en Supabase → **SQL Editor** → *New query* → pegar → *Run*.

| # | Script | Qué hace | ¿Hace falta? |
|---|---|---|---|
| 01 | `01_tablas.sql` | Las seis tablas con su estructura final | Sí |
| 02 | `02_migraciones.sql` | Lleva una base de una versión anterior a la estructura de 01. En una base nueva no hace nada | Sí |
| 03 | `03_indices.sql` | Índices para el RLS y para las claves foráneas | Sí |
| 04 | `04_seguridad.sql` | RLS: cada cuenta ve y cambia solo lo suyo | Sí |
| 05 | `05_calculos.sql` | Las vistas que calculan el costo real de cada producto, el resumen de cada caja, los saldos de los fiados y la función de venta | Sí |
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

## Base nueva o existente: el mismo camino

No hay un camino para instalar y otro para actualizar. En una base vacía, 01 crea todo y 02 no encuentra nada que migrar. En una base de una versión anterior, 01 no toca las tablas y 02 las lleva a la estructura actual. En los dos casos, 03 a 06 dejan índices, seguridad, vistas y fotos como deben quedar.

Si 02 encuentra datos que apuntan a otra cuenta, se detiene y avisa en vez de fallar a medias; 08 muestra cuáles son.

## Dependencias de Supabase

01 usa `auth.users` y `auth.uid()`; 04 y 05 usan los roles `authenticated` y `anon`; 06 usa el esquema `storage`. Todo eso ya existe en cualquier proyecto de Supabase.

## Cómo se probaron

Los scripts se ejecutaron en un Postgres real (PGlite) con lo mínimo de Supabase simulado, en dos escenarios: una base vacía y una copia de la base con la historia real del proyecto (esquema v1 con su muestra, luego la migración de monedas). En los dos, correr todo por segunda vez deja la estructura y los datos idénticos.
