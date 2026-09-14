-- Cuenta Clara · 08 · Revisión (solo lectura)
--
-- No cambia nada: solo lee. Devuelve una tabla con cada revisión, su estado
-- (✅ bien · ⚠️ para mirar · ❌ problema · ℹ️ información) y el detalle.
-- Correlo después de 01 a 06.
--
-- Desde el SQL Editor corre como administrador y ve los datos de todas las
-- cuentas: sirve para revisar la base entera, no la de una sola persona.

with
tablas(nombre) as (
  values ('cajas'), ('productos'), ('clientas'), ('ventas'), ('detalle_venta'), ('abonos')
),
vistas(nombre) as (
  values ('cajas_calculo'), ('cajas_resumen'), ('productos_costeados'), ('fiados')
),
referencias(nombre) as (
  values ('productos_caja_del_mismo_dueno'), ('ventas_clienta_del_mismo_dueno'),
         ('detalle_venta_del_mismo_dueno'), ('detalle_producto_del_mismo_dueno'),
         ('abonos_venta_del_mismo_dueno')
),
cruzadas(que, n) as (
  select 'producto → caja', count(*) from public.productos p join public.cajas c on c.id = p.caja_id where c.owner_id <> p.owner_id
  union all
  select 'venta → clienta', count(*) from public.ventas v join public.clientas cl on cl.id = v.clienta_id where cl.owner_id <> v.owner_id
  union all
  select 'detalle → venta', count(*) from public.detalle_venta d join public.ventas v on v.id = d.venta_id where v.owner_id <> d.owner_id
  union all
  select 'detalle → producto', count(*) from public.detalle_venta d join public.productos p on p.id = d.producto_id where p.owner_id <> d.owner_id
  union all
  select 'abono → venta', count(*) from public.abonos a join public.ventas v on v.id = a.venta_id where v.owner_id <> a.owner_id
),
descuadres as (
  -- Lo que salió del stock tiene que coincidir con lo vendido desde la app.
  select p.nombre, p.cantidad - p.stock as salio, coalesce(sum(d.cantidad), 0) as vendido
  from public.productos p
  left join public.detalle_venta d on d.producto_id = p.id
  group by p.id, p.nombre, p.cantidad, p.stock
  having p.cantidad - p.stock <> coalesce(sum(d.cantidad), 0)
),
revisiones(orden, grupo, revision, estado, detalle) as (
  select 1, 'Estructura', 'Tablas',
         case when count(t.tablename) = 6 then 'ok' else 'error' end,
         count(t.tablename) || ' de 6'
    from tablas e
    left join pg_tables t on t.schemaname = 'public' and t.tablename = e.nombre
  union all
  select 2, 'Estructura', 'Moneda por gasto y colchón',
         case when count(*) = 5 then 'ok' else 'error' end,
         count(*) || ' de 5 columnas'
    from information_schema.columns
   where table_schema = 'public' and table_name = 'cajas'
     and column_name in ('lote_moneda', 'flete_moneda', 'aduana_moneda', 'otros_moneda', 'colchon')
  union all
  select 3, 'Estructura', 'Vistas del cálculo, con el RLS de quien consulta',
         case when count(*) filter (where array_to_string(c.reloptions, ',') ~ 'security_invoker=(on|true|1)') = 4
              then 'ok' else 'error' end,
         count(*) filter (where array_to_string(c.reloptions, ',') ~ 'security_invoker=(on|true|1)') || ' de 4'
    from vistas v
    left join pg_class c on c.relname = v.nombre and c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 4, 'Integridad', 'Referencias atadas al mismo dueño',
         case when count(c.conname) = 5 then 'ok' else 'error' end,
         count(c.conname) || ' de 5'
    from referencias r
    left join pg_constraint c on c.conname = r.nombre
  union all
  select 5, 'Seguridad', 'RLS activado',
         case when count(*) filter (where c.relrowsecurity) = 6 then 'ok' else 'error' end,
         coalesce('sin RLS: ' || string_agg(c.relname, ', ') filter (where not c.relrowsecurity), 'las 6 tablas')
    from tablas e
    join pg_class c on c.relname = e.nombre and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  union all
  select 6, 'Seguridad', 'Política "solo lo propio"',
         case when count(*) = 6 then 'ok' else 'error' end,
         count(*) || ' de 6 tablas'
    from pg_policies
   where schemaname = 'public' and policyname = 'solo lo propio'
  union all
  select 7, 'Seguridad', 'Solo con sesión se puede vender',
         case when to_regprocedure('public.vender_producto(uuid,integer)') is null then 'error'
              when has_function_privilege('anon', 'public.vender_producto(uuid,integer)', 'execute') then 'error'
              else 'ok' end,
         case when to_regprocedure('public.vender_producto(uuid,integer)') is null then 'falta la función' else '' end
  union all
  select 8, 'Seguridad', 'Fotos: cada cuenta lista solo las suyas',
         case when exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'ver fotos propias')
               and not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'ver fotos')
              then 'ok' else 'error' end,
         ''
  union all
  select 9, 'Seguridad', 'Bucket de fotos',
         case when exists (select 1 from storage.buckets where id = 'fotos' and public) then 'ok' else 'error' end,
         ''
  union all
  select 10, 'Datos', 'Referencias a otra cuenta',
         case when sum(n) = 0 then 'ok' else 'error' end,
         coalesce(string_agg(que || ': ' || n, ', ') filter (where n > 0), 'ninguna')
    from cruzadas
  union all
  select 11, 'Datos', 'Stock coherente con las ventas',
         case when count(*) = 0 then 'ok' else 'aviso' end,
         coalesce(string_agg(nombre || ' (salieron ' || salio || ', vendidos ' || vendido || ')', '; '), 'todo coincide')
    from descuadres
  union all
  select 12, 'Datos', 'Abonos que superan la deuda',
         case when count(*) = 0 then 'ok' else 'error' end,
         coalesce(string_agg(clienta || ' (' || abonado || ' de ' || total || ')', '; '), 'ninguno')
    from public.fiados
   where abonado > total
  union all
  select 13, 'Datos', 'Productos con precio por debajo del costo',
         case when count(*) = 0 then 'ok' else 'aviso' end,
         coalesce(string_agg(nombre || ' (cuesta ' || costo_unitario || ', se vende a ' || precio || ')', '; '), 'ninguno')
    from public.productos_costeados
   where precio > 0 and precio < costo_unitario
  union all
  select 14, 'Datos', 'Productos sin precio de venta',
         case when count(*) = 0 then 'ok' else 'aviso' end,
         coalesce(string_agg(nombre, ', '), 'ninguno')
    from public.productos
   where precio = 0
  union all
  select 15, 'Datos', 'Cajas sin productos',
         case when count(*) = 0 then 'ok' else 'aviso' end,
         coalesce(string_agg(descripcion, ', '), 'ninguna')
    from public.cajas_resumen
   where productos = 0
  union all
  select 16, 'Cuentas', coalesce(u.email, u.id::text), 'info',
            (select count(*) from public.cajas c where c.owner_id = u.id) || ' cajas · '
         || (select count(*) from public.productos p where p.owner_id = u.id) || ' productos · '
         || (select count(*) from public.ventas v where v.owner_id = u.id and v.es_fiada) || ' fiados · por cobrar L '
         || (select coalesce(sum(f.saldo), 0) from public.fiados f where f.owner_id = u.id)
    from auth.users u
)
select grupo,
       revision,
       case estado when 'ok' then '✅' when 'aviso' then '⚠️' when 'info' then 'ℹ️' else '❌' end as estado,
       detalle
from revisiones
order by orden, revision;
