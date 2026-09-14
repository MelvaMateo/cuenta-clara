-- Cuenta Clara · 02 · Migraciones
--
-- Lleva una base creada con una versión anterior a la estructura de
-- 01_tablas.sql. En una base nueva no hace nada. Cada paso revisa antes de
-- cambiar, así que se puede correr las veces que haga falta.
--
-- Versiones que cubre:
--   v1  los gastos de la caja iban solo en dólares (costo_lote_usd, flete_usd…)
--   v2  cada gasto con su moneda, más el colchón cambiario
--   v3  cada referencia entre tablas atada al mismo owner_id
--   v4  textos en forma canónica
--
-- Después de este script van 03, 04, 05 y 06: vuelven a crear índices,
-- políticas, vistas y fotos con la definición actual.

-- ------------------------------------------------------ v1 → v2: monedas
-- Las columnas *_usd pasan a llamarse por lo que guardan: un monto, en la
-- moneda que diga su columna *_moneda. Las vistas dependen de esos nombres,
-- así que se sacan antes; 05_calculos.sql las vuelve a crear.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'cajas'
                and column_name = 'costo_lote_usd') then
    drop view if exists public.productos_costeados;
    drop view if exists public.cajas_resumen;
    drop view if exists public.cajas_calculo;
    alter table public.cajas rename column costo_lote_usd to lote;
    alter table public.cajas rename column flete_usd      to flete;
    alter table public.cajas rename column aduana_usd     to aduana;
    alter table public.cajas rename column otros_usd      to otros;
  end if;
end $$;

-- Las cajas que ya existían quedan como se cargaron: gastos en dólares y
-- colchón en 0, para que ningún precio sugerido cambie solo.
alter table public.cajas
  add column if not exists lote_moneda   text not null default 'USD' check (lote_moneda   in ('USD', 'HNL')),
  add column if not exists flete_moneda  text not null default 'USD' check (flete_moneda  in ('USD', 'HNL')),
  add column if not exists aduana_moneda text not null default 'USD' check (aduana_moneda in ('USD', 'HNL')),
  add column if not exists otros_moneda  text not null default 'USD' check (otros_moneda  in ('USD', 'HNL')),
  add column if not exists colchon       numeric(4,3) not null default 0 check (colchon >= 0 and colchon <= 0.5);

-- De acá en adelante, lo mismo que una base nueva.
alter table public.cajas
  alter column aduana_moneda set default 'HNL',
  alter column colchon       set default 0.030;

-- ------------------------------------------- v2 → v3: mismo dueño siempre
-- Antes las referencias solo validaban el id: una fila de una cuenta podía
-- apuntar a datos de otra (por ejemplo, un abono al fiado de otra persona).
-- El RLS impedía verlos, pero la base lo aceptaba.

-- Primero se revisa que los datos ya lo cumplan, para explicar el problema
-- en vez de fallar con un error de restricción difícil de leer.
do $$
declare
  cruzadas bigint;
begin
  select count(*) into cruzadas from (
    select 1 from public.productos p     join public.cajas c     on c.id = p.caja_id     where c.owner_id <> p.owner_id
    union all
    select 1 from public.ventas v        join public.clientas cl on cl.id = v.clienta_id where cl.owner_id <> v.owner_id
    union all
    select 1 from public.detalle_venta d join public.ventas v    on v.id = d.venta_id    where v.owner_id <> d.owner_id
    union all
    select 1 from public.detalle_venta d join public.productos p on p.id = d.producto_id where p.owner_id <> d.owner_id
    union all
    select 1 from public.abonos a        join public.ventas v    on v.id = a.venta_id    where v.owner_id <> a.owner_id
  ) x;
  if cruzadas > 0 then
    raise exception 'Hay % filas que apuntan a datos de otra cuenta. Corré 08_verificacion.sql para ver cuáles.', cruzadas;
  end if;
end $$;

-- Las tablas a las que se apunta necesitan (id, owner_id) como clave única.
do $$
declare
  t text;
begin
  foreach t in array array['cajas', 'productos', 'clientas', 'ventas'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_id_dueno_unico') then
      execute format('alter table public.%I add constraint %I unique (id, owner_id)', t, t || '_id_dueno_unico');
    end if;
  end loop;
end $$;

-- Cada referencia por id se reemplaza por una por (id, owner_id).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_caja_del_mismo_dueno') then
    alter table public.productos drop constraint if exists productos_caja_id_fkey;
    alter table public.productos add constraint productos_caja_del_mismo_dueno
      foreign key (caja_id, owner_id) references public.cajas (id, owner_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ventas_clienta_del_mismo_dueno') then
    alter table public.ventas drop constraint if exists ventas_clienta_id_fkey;
    alter table public.ventas add constraint ventas_clienta_del_mismo_dueno
      foreign key (clienta_id, owner_id) references public.clientas (id, owner_id) on delete set null (clienta_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'detalle_venta_del_mismo_dueno') then
    alter table public.detalle_venta drop constraint if exists detalle_venta_venta_id_fkey;
    alter table public.detalle_venta add constraint detalle_venta_del_mismo_dueno
      foreign key (venta_id, owner_id) references public.ventas (id, owner_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'detalle_producto_del_mismo_dueno') then
    alter table public.detalle_venta drop constraint if exists detalle_venta_producto_id_fkey;
    alter table public.detalle_venta add constraint detalle_producto_del_mismo_dueno
      foreign key (producto_id, owner_id) references public.productos (id, owner_id) on delete set null (producto_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'abonos_venta_del_mismo_dueno') then
    alter table public.abonos drop constraint if exists abonos_venta_id_fkey;
    alter table public.abonos add constraint abonos_venta_del_mismo_dueno
      foreign key (venta_id, owner_id) references public.ventas (id, owner_id) on delete cascade;
  end if;
end $$;

-- ------------------------------------------------ v3 → v4: textos canónicos
-- 01 hace que los textos nuevos entren en forma canónica; acá se llevan a esa
-- forma los que ya estaban. Si dos clientas de una cuenta quedaran con el
-- mismo nombre ("Karla Pérez" y "Karla  Pérez"), se avisa en vez de fallar a
-- medias: hay que decidir a mano con cuál quedarse.
do $$
declare
  repetidas text;
begin
  select string_agg(nombre, ', ') into repetidas from (
    select min(public.texto_canonico(nombre)) as nombre
      from public.clientas
     group by owner_id, lower(public.texto_canonico(nombre))
    having count(*) > 1
  ) x;
  if repetidas is not null then
    raise exception 'Al normalizar los nombres quedarían clientas repetidas: %. Pasá sus fiados a una sola, borrá la otra y corré de nuevo.', repetidas;
  end if;
end $$;

update public.cajas     set descripcion = public.texto_canonico(descripcion)
 where descripcion is distinct from public.texto_canonico(descripcion);
update public.productos set nombre = public.texto_canonico(nombre)
 where nombre is distinct from public.texto_canonico(nombre);
update public.clientas  set nombre = public.texto_canonico(nombre), telefono = public.texto_canonico(telefono)
 where nombre is distinct from public.texto_canonico(nombre)
    or telefono is distinct from public.texto_canonico(telefono);
update public.ventas    set descripcion = public.texto_canonico(descripcion)
 where descripcion is distinct from public.texto_canonico(descripcion);

-- La API de Supabase vuelve a leer la estructura.
notify pgrst, 'reload schema';
