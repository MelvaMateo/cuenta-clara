-- Cuenta Clara — esquema completo (modelo de PLAN.md, sección 3).
-- Correr una sola vez en: Supabase → SQL Editor → New query → Run.
--
-- Cada fila lleva owner_id y RLS deja ver solo lo propio: aunque alguien más
-- entre a la app, no toca el inventario de otra persona.

-- ---------------------------------------------------------------- clientas
create table if not exists public.clientas (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  telefono   text,
  creada_en  timestamptz not null default now()
);

-- "Karla" y "karla" eran dos deudoras distintas cuando el nombre era texto
-- suelto. El índice va sobre lower(nombre) para que coincida con la búsqueda
-- insensible a mayúsculas que hace el frontend al buscar o crear la clienta.
create unique index if not exists clientas_nombre_unico
  on public.clientas (owner_id, lower(nombre));

-- ------------------------------------------------------------------- cajas
-- Cada caja importada desde USA. Habilita el margen por caja (US4, US10).
create table if not exists public.cajas (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  descripcion     text not null,
  fecha           date not null default current_date,
  costo_total_usd numeric(10,2) check (costo_total_usd >= 0),
  tipo_cambio     numeric(10,4) check (tipo_cambio > 0),
  creada_en       timestamptz not null default now()
);

-- --------------------------------------------------------------- productos
create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  caja_id      uuid references public.cajas(id) on delete set null,
  nombre       text not null check (length(trim(nombre)) > 0),
  costo        numeric(10,2) not null default 0 check (costo >= 0),
  precio       numeric(10,2) not null check (precio >= 0),
  stock        integer not null default 0 check (stock >= 0),
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  creado_en    timestamptz not null default now()
);

-- ------------------------------------------------------------------ ventas
-- Un fiado es una venta con es_fiada = true. Así US6 y US5 comparten tabla.
create table if not exists public.ventas (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clienta_id  uuid references public.clientas(id) on delete set null,
  descripcion text,
  canal       text not null default 'local' check (canal in ('local', 'redes')),
  es_fiada    boolean not null default false,
  total       numeric(10,2) not null check (total >= 0),
  fecha       timestamptz not null default now(),
  -- un fiado sin clienta no se podría cobrar
  constraint fiada_necesita_clienta check (not es_fiada or clienta_id is not null)
);

-- ----------------------------------------------------------- detalle_venta
create table if not exists public.detalle_venta (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  venta_id    uuid not null references public.ventas(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  cantidad    integer not null check (cantidad > 0),
  precio_unit numeric(10,2) not null check (precio_unit >= 0)
);

-- ------------------------------------------------------------------ abonos
create table if not exists public.abonos (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  venta_id uuid not null references public.ventas(id) on delete cascade,
  monto    numeric(10,2) not null check (monto > 0),
  fecha    timestamptz not null default now()
);

-- ------------------------------------------------------------------ índices
create index if not exists productos_owner_idx     on public.productos (owner_id);
create index if not exists clientas_owner_idx      on public.clientas (owner_id);
create index if not exists cajas_owner_idx         on public.cajas (owner_id);
create index if not exists ventas_owner_fiada_idx  on public.ventas (owner_id, es_fiada);
create index if not exists ventas_clienta_idx      on public.ventas (clienta_id);
create index if not exists abonos_venta_idx        on public.abonos (venta_id);
create index if not exists detalle_venta_idx       on public.detalle_venta (venta_id);
create index if not exists detalle_producto_idx    on public.detalle_venta (producto_id);

-- --------------------------------------------------------------------- RLS
alter table public.clientas      enable row level security;
alter table public.cajas         enable row level security;
alter table public.productos     enable row level security;
alter table public.ventas        enable row level security;
alter table public.detalle_venta enable row level security;
alter table public.abonos        enable row level security;

-- El (select auth.uid()) se evalúa una sola vez por consulta, no por fila.
do $$
declare t text;
begin
  foreach t in array array['clientas','cajas','productos','ventas','detalle_venta','abonos'] loop
    execute format('drop policy if exists "solo lo propio" on public.%I', t);
    execute format($f$
      create policy "solo lo propio" on public.%I
        for all to authenticated
        using (owner_id = (select auth.uid()))
        with check (owner_id = (select auth.uid()))
    $f$, t);
  end loop;
end $$;

-- ------------------------------------------------------- vista de fiados
-- Saldo = total − abonos. Evita traer los abonos aparte para cada fiado.
-- security_invoker: la vista respeta el RLS de quien consulta, no el de su
-- creador. Sin esto, cualquiera vería los fiados de todas.
drop view if exists public.fiados;
create view public.fiados with (security_invoker = on) as
  select
    v.id,
    v.owner_id,
    v.clienta_id,
    c.nombre                                    as clienta,
    v.descripcion,
    v.total,
    v.fecha,
    coalesce(sum(a.monto), 0)                   as abonado,
    v.total - coalesce(sum(a.monto), 0)         as saldo
  from public.ventas v
  left join public.clientas c on c.id = v.clienta_id
  left join public.abonos   a on a.venta_id = v.id
  where v.es_fiada
  group by v.id, c.nombre;

-- ------------------------------------------------------- venta de producto
-- Descuenta stock en una sola sentencia. Hacerlo con leer-y-luego-escribir
-- desde el navegador permite vender más de lo que hay si entran dos ventas
-- a la vez; el "where stock >= cantidad" lo vuelve imposible.
create or replace function public.vender_producto(p_id uuid, p_cantidad integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_stock integer;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  update public.productos
     set stock = stock - p_cantidad
   where id = p_id and stock >= p_cantidad
  returning stock into v_stock;

  if not found then
    raise exception 'No hay suficiente stock';
  end if;

  return v_stock;
end $$;
