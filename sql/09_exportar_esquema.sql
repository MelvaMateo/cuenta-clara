-- Cuenta Clara · 09 · Exportar el modelo de datos (solo lectura)
--
-- Devuelve, en una sola celda, el modelo de datos real en JSON: cada tabla con
-- su cantidad de filas, sus columnas, índices, relaciones y políticas RLS. Es
-- lo que se guarda en docs/db-export.json.
--
-- No cambia nada de la base. La única función que crea es temporal (pg_temp):
-- desaparece al cerrar la sesión.
--
-- Correlo en Supabase → SQL Editor. Corre como administrador, así que cuenta
-- las filas de todas las cuentas.
--
-- Las referencias de este modelo son compuestas, (x_id, owner_id), para que
-- una fila nunca apunte a datos de otra cuenta. En "relaciones" se muestran
-- por su primera columna: la que dice a qué fila apunta.

-- Cuenta las filas de una tabla. Hace falta SQL dinámico: count(*) no recibe
-- el nombre de la tabla como un dato.
create or replace function pg_temp.filas(tabla regclass)
returns bigint
language plpgsql
as $$
declare
  n bigint;
begin
  execute format('select count(*) from %s', tabla) into n;
  return n;
end $$;

with tablas as (
  select c.oid, c.relname::text as nombre
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
)
select json_build_object(
  'generado_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'motor', 'postgres',
  'tablas', (
    select json_agg(json_build_object(
      'nombre', t.nombre,
      'filas', pg_temp.filas(t.oid),
      'columnas', (
        select json_agg(json_build_object(
                 'nombre', a.attname::text,
                 'tipo', format_type(a.atttypid, a.atttypmod),
                 'pk', exists (select 1 from pg_constraint k
                                where k.conrelid = t.oid and k.contype = 'p' and a.attnum = any (k.conkey)),
                 'nulo', not a.attnotnull
               ) order by a.attnum)
          from pg_attribute a
         where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      ),
      'indices', coalesce((
        select json_agg(i.relname::text order by i.relname)
          from pg_index x
          join pg_class i on i.oid = x.indexrelid
         where x.indrelid = t.oid
      ), '[]'::json),
      'relaciones', coalesce((
        select json_agg(json_build_object(
                 'columna', (select attname::text from pg_attribute where attrelid = k.conrelid and attnum = k.conkey[1]),
                 'referencia', r.relname || '.' || (select attname from pg_attribute where attrelid = k.confrelid and attnum = k.confkey[1])
               ) order by k.conname)
          from pg_constraint k
          join pg_class r on r.oid = k.confrelid
         where k.conrelid = t.oid and k.contype = 'f' and r.relnamespace = 'public'::regnamespace
      ), '[]'::json),
      'politicas_rls', coalesce((
        select json_agg(p.policyname::text order by p.policyname)
          from pg_policies p
         where p.schemaname = 'public' and p.tablename = t.nombre
      ), '[]'::json)
    ) order by t.nombre)
    from tablas t
  )
) as export;
