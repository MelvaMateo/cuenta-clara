-- Cuenta Clara — esquema.
-- Correr una sola vez en: Supabase → SQL Editor → New query → Run.
--
-- El negocio: quien emprende trae cajas desde USA (parte en lotes surtidos sin precios
-- por producto, parte comprada en tiendas con recibo), paga flete y aduana, y
-- las revende. Suele ponerles precio sin tomar en cuenta lo que costó
-- traerlo, así que no sabe si la caja le deja ganancia.
--
-- La app resuelve eso repartiendo el costo REAL de la caja entre sus productos:
--   · lo comprado en tienda conserva su costo exacto
--   · lo del lote reparte el costo del lote según el valor estimado de cada cosa
--   · flete y aduana se reparten entre todo, proporcional al valor
-- Nada se inventa: el total siempre queda anclado a lo que se pagó.
--
-- Cada fila lleva owner_id y RLS deja ver solo lo propio.

-- ------------------------------------------------------------------- cajas
create table if not exists public.cajas (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  descripcion     text not null check (length(trim(descripcion)) > 0),
  fecha           date not null default current_date,

  -- Cada monto va en la moneda en que se pagó: lo de USA en dólares, la
  -- aduana normalmente en lempiras. Solo lo pagado en dólares usa tipo_cambio.

  -- Lo que pagó por el lote surtido. 0 si llenó la caja solo con compras.
  lote            numeric(10,2) not null default 0 check (lote >= 0),
  lote_moneda     text not null default 'USD' check (lote_moneda in ('USD', 'HNL')),

  -- Lo que costó traerla: justo lo que no se toma en cuenta al poner precio a ojo.
  flete           numeric(10,2) not null default 0 check (flete >= 0),
  flete_moneda    text not null default 'USD' check (flete_moneda in ('USD', 'HNL')),
  aduana          numeric(10,2) not null default 0 check (aduana >= 0),
  aduana_moneda   text not null default 'HNL' check (aduana_moneda in ('USD', 'HNL')),
  otros           numeric(10,2) not null default 0 check (otros >= 0),
  otros_moneda    text not null default 'USD' check (otros_moneda in ('USD', 'HNL')),

  -- El dólar al que se pagó, no el del día. Queda fijo con la caja, así los
  -- precios no cambian cada vez que se mueve el tipo de cambio.
  tipo_cambio     numeric(10,4) not null check (tipo_cambio > 0),
  margen_deseado  numeric(4,3)  not null default 0.400 check (margen_deseado >= 0),

  -- Colchón cambiario: sube el precio sugerido de la parte pagada en dólares,
  -- por si el dólar está más caro cuando toque reponer. No toca el costo real.
  colchon         numeric(4,3)  not null default 0.030 check (colchon >= 0 and colchon <= 0.5),

  creada_en       timestamptz not null default now()
);

-- --------------------------------------------------------------- productos
create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  caja_id      uuid not null references public.cajas(id) on delete cascade,
  nombre       text not null check (length(trim(nombre)) > 0),
  foto_path    text,

  -- 'tienda': valor_usd es el costo REAL que pagó (tiene el recibo).
  -- 'lote'  : valor_usd es su ESTIMACIÓN, y solo se usa para repartir
  --           proporcionalmente lo que costó el lote. Si estima de más o de
  --           menos no importa, mientras las proporciones sean razonables.
  origen       text not null check (origen in ('lote', 'tienda')),
  valor_usd    numeric(10,2) not null check (valor_usd >= 0),   -- por unidad

  cantidad     integer not null check (cantidad > 0),            -- unidades recibidas
  stock        integer not null check (stock >= 0),              -- unidades que quedan
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  precio       numeric(10,2) not null default 0 check (precio >= 0),  -- venta, en lempiras

  creado_en    timestamptz not null default now(),
  constraint stock_no_mayor_que_cantidad check (stock <= cantidad)
);

-- ---------------------------------------------------------------- clientas
create table if not exists public.clientas (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  telefono   text,
  creada_en  timestamptz not null default now()
);

-- "Karla" y "karla" no pueden ser dos deudoras distintas.
create unique index if not exists clientas_nombre_unico
  on public.clientas (owner_id, lower(nombre));

-- ------------------------------------------------------------------ ventas
-- Un fiado es una venta con es_fiada = true.
create table if not exists public.ventas (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clienta_id  uuid references public.clientas(id) on delete set null,
  descripcion text,
  canal       text not null default 'local' check (canal in ('local', 'redes')),
  es_fiada    boolean not null default false,
  total       numeric(10,2) not null check (total >= 0),
  fecha       timestamptz not null default now(),
  constraint fiada_necesita_clienta check (not es_fiada or clienta_id is not null)
);

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
create index if not exists cajas_owner_idx        on public.cajas (owner_id);
create index if not exists productos_owner_idx    on public.productos (owner_id);
create index if not exists productos_caja_idx     on public.productos (caja_id);
create index if not exists clientas_owner_idx     on public.clientas (owner_id);
create index if not exists ventas_owner_fiada_idx on public.ventas (owner_id, es_fiada);
create index if not exists abonos_venta_idx       on public.abonos (venta_id);
create index if not exists detalle_venta_idx      on public.detalle_venta (venta_id);
create index if not exists detalle_producto_idx   on public.detalle_venta (producto_id);

-- --------------------------------------------------------------------- RLS
alter table public.cajas         enable row level security;
alter table public.productos     enable row level security;
alter table public.clientas      enable row level security;
alter table public.ventas        enable row level security;
alter table public.detalle_venta enable row level security;
alter table public.abonos        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cajas','productos','clientas','ventas','detalle_venta','abonos'] loop
    execute format('drop policy if exists "solo lo propio" on public.%I', t);
    execute format($f$
      create policy "solo lo propio" on public.%I
        for all to authenticated
        using (owner_id = (select auth.uid()))
        with check (owner_id = (select auth.uid()))
    $f$, t);
  end loop;
end $$;

-- ============================================================================
-- El cálculo: cuánto costó de verdad cada producto
-- ============================================================================
-- security_invoker: las vistas respetan el RLS de quien consulta. Sin esto,
-- cualquiera vería las cajas de todas.
--
-- Todo se lleva a lempiras: lo pagado en dólares se convierte con el
-- tipo_cambio de la caja y lo pagado en lempiras entra tal cual.

drop view if exists public.productos_costeados;
drop view if exists public.cajas_resumen;
drop view if exists public.cajas_calculo;

-- Una sola vista hace las cuentas de cada caja; las otras dos la usan, así la
-- fórmula vive en un solo lugar.
create view public.cajas_calculo with (security_invoker = on) as
select
  c.id,
  c.owner_id,
  c.tipo_cambio,
  c.margen_deseado,
  c.colchon,
  inv.peso_lote,
  inv.tienda_usd,
  inv.productos,
  inv.unidades,
  inv.en_stock,
  inv.valor_venta,
  inv.por_vender,
  lps.lote_lps,
  lps.flete_lps + lps.aduana_lps + lps.otros_lps                             as gastos_lps,
  tot.mercaderia_lps,
  tot.invertido,
  -- factor: cuánto encarece traer la caja. 1.24 = "cada L 1 de mercadería llega costando L 1.24".
  case when tot.mercaderia_lps > 0
       then 1 + (lps.flete_lps + lps.aduana_lps + lps.otros_lps) / tot.mercaderia_lps
       else 1 end                                                             as factor,
  -- k: lempiras reales por cada dólar estimado del lote. Si estimó $304 en
  -- total y el lote costó L 4,930, cada dólar estimado vale L 16.22.
  case when inv.peso_lote > 0 then lps.lote_lps / inv.peso_lote else 0 end   as k,
  -- Qué parte de la caja se pagó en dólares: es la única expuesta a que el
  -- dólar suba, y la única a la que se le aplica el colchón.
  case when tot.invertido > 0 then tot.en_dolares / tot.invertido else 0 end as parte_usd
from public.cajas c
left join lateral (
  select
    coalesce(sum(p.valor_usd * p.cantidad) filter (where p.origen = 'lote'), 0)   as peso_lote,
    coalesce(sum(p.valor_usd * p.cantidad) filter (where p.origen = 'tienda'), 0) as tienda_usd,
    count(p.id)                             as productos,
    coalesce(sum(p.cantidad), 0)            as unidades,
    coalesce(sum(p.stock), 0)               as en_stock,
    coalesce(sum(p.precio * p.cantidad), 0) as valor_venta,
    coalesce(sum(p.precio * p.stock), 0)    as por_vender
  from public.productos p
  where p.caja_id = c.id
) inv on true
cross join lateral (
  select
    c.lote   * case when c.lote_moneda   = 'USD' then c.tipo_cambio else 1 end as lote_lps,
    c.flete  * case when c.flete_moneda  = 'USD' then c.tipo_cambio else 1 end as flete_lps,
    c.aduana * case when c.aduana_moneda = 'USD' then c.tipo_cambio else 1 end as aduana_lps,
    c.otros  * case when c.otros_moneda  = 'USD' then c.tipo_cambio else 1 end as otros_lps
) lps
cross join lateral (
  select
    lps.lote_lps + inv.tienda_usd * c.tipo_cambio                               as mercaderia_lps,
    lps.lote_lps + inv.tienda_usd * c.tipo_cambio
      + lps.flete_lps + lps.aduana_lps + lps.otros_lps                          as invertido,
    inv.tienda_usd * c.tipo_cambio
      + case when c.lote_moneda   = 'USD' then lps.lote_lps   else 0 end
      + case when c.flete_moneda  = 'USD' then lps.flete_lps  else 0 end
      + case when c.aduana_moneda = 'USD' then lps.aduana_lps else 0 end
      + case when c.otros_moneda  = 'USD' then lps.otros_lps  else 0 end        as en_dolares
) tot;

-- ------------------------------------------------- resumen de cada caja
-- Responde "¿esta caja me deja ganancia?" y "¿cuánto me falta para recuperar?"
create view public.cajas_resumen with (security_invoker = on) as
select
  c.id, c.owner_id, c.descripcion, c.fecha,
  c.lote, c.lote_moneda, c.flete, c.flete_moneda,
  c.aduana, c.aduana_moneda, c.otros, c.otros_moneda,
  c.tipo_cambio, c.margen_deseado, c.colchon,
  k.tienda_usd,
  round(k.mercaderia_lps, 2)                                  as mercaderia_lps,
  round(k.gastos_lps, 2)                                      as gastos_lps,
  round(k.invertido, 2)                                       as invertido,
  round(k.factor, 4)                                          as factor,
  k.peso_lote,
  round(k.k, 6)                                               as k,
  round(k.parte_usd, 4)                                       as parte_usd,
  k.productos, k.unidades, k.en_stock,
  k.valor_venta,                                              -- si vende todo
  k.por_vender,                                               -- lo que queda, a precio
  coalesce(v.vendido, 0)                                      as vendido,
  round(k.valor_venta - k.invertido, 2)                       as ganancia_proyectada,
  greatest(round(k.invertido - coalesce(v.vendido, 0), 2), 0) as falta_recuperar
from public.cajas c
join public.cajas_calculo k on k.id = c.id
left join lateral (
  select coalesce(sum(dv.cantidad * dv.precio_unit), 0) as vendido
  from public.detalle_venta dv
  join public.productos p on p.id = dv.producto_id
  where p.caja_id = c.id
) v on true;

-- ------------------------------------------- costo y precio de cada producto
create view public.productos_costeados with (security_invoker = on) as
select
  p.id, p.owner_id, p.caja_id, c.descripcion as caja, p.nombre, p.foto_path, p.origen,
  p.valor_usd, p.cantidad, p.stock, p.stock_minimo, p.precio,
  round(k.factor, 4)                                                         as factor,
  round(u.costo, 2)                                                          as costo_unitario,
  -- El colchón se aplica solo a la parte pagada en dólares; el margen, a todo.
  round(u.costo * (1 + k.colchon * k.parte_usd) * (1 + k.margen_deseado), 2) as precio_sugerido
from public.productos p
join public.cajas c         on c.id = p.caja_id
join public.cajas_calculo k on k.id = p.caja_id
cross join lateral (
  -- Lo del lote reparte el costo del lote según su estimación; lo de tienda es
  -- su costo exacto en dólares. Después se le suma su parte de los gastos.
  select (case when p.origen = 'lote' then p.valor_usd * k.k
               else p.valor_usd * k.tipo_cambio end) * k.factor as costo
) u;

-- --------------------------------------------------------- vista de fiados
drop view if exists public.fiados;
create view public.fiados with (security_invoker = on) as
  select
    v.id, v.owner_id, v.clienta_id,
    cl.nombre                             as clienta,
    v.descripcion, v.total, v.fecha,
    coalesce(sum(a.monto), 0)             as abonado,
    v.total - coalesce(sum(a.monto), 0)   as saldo
  from public.ventas v
  left join public.clientas cl on cl.id = v.clienta_id
  left join public.abonos   a  on a.venta_id = v.id
  where v.es_fiada
  group by v.id, cl.nombre;

-- ------------------------------------------------------- venta de producto
-- Descuenta stock y deja registrada la venta, para que la caja sepa cuánto
-- lleva recuperado. El "where stock >= cantidad" hace imposible vender de más.
create or replace function public.vender_producto(p_id uuid, p_cantidad integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_stock  integer;
  v_precio numeric(10,2);
  v_owner  uuid;
  v_venta  uuid;
begin
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  update public.productos
     set stock = stock - p_cantidad
   where id = p_id and stock >= p_cantidad
  returning stock, precio, owner_id into v_stock, v_precio, v_owner;

  if not found then
    raise exception 'No hay suficiente stock';
  end if;

  insert into public.ventas (owner_id, total, canal, es_fiada)
       values (v_owner, v_precio * p_cantidad, 'local', false)
    returning id into v_venta;

  insert into public.detalle_venta (owner_id, venta_id, producto_id, cantidad, precio_unit)
       values (v_owner, v_venta, p_id, p_cantidad, v_precio);

  return v_stock;
end $$;

-- ============================================================ fotos (Storage)
-- Bucket público para que las fotos se vean sin firmar URLs. Subir y borrar
-- queda restringido a la carpeta de cada usuaria: <uid>/<archivo>.
insert into storage.buckets (id, name, public)
     values ('fotos', 'fotos', true)
on conflict (id) do nothing;

drop policy if exists "ver fotos"           on storage.objects;
drop policy if exists "subir fotos propias" on storage.objects;
drop policy if exists "borrar fotos propias" on storage.objects;

create policy "ver fotos" on storage.objects
  for select to public using (bucket_id = 'fotos');

create policy "subir fotos propias" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "borrar fotos propias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
