-- Cuenta Clara · 01 · Tablas
--
-- Estructura final de las seis tablas. Idempotente: "create table if not
-- exists" no toca una tabla que ya existe; si la base viene de una versión
-- anterior, 02_migraciones.sql la lleva a esta misma estructura.
--
-- Orden: 01 → 02 → 03 → 04 → 05 → 06, y opcionalmente 07 (muestra) y 08
-- (revisión). Todos se pueden correr las veces que haga falta.
--
-- El negocio: quien emprende trae cajas desde USA (parte en lotes surtidos sin
-- precio por producto, parte comprada en tiendas con recibo), paga flete y
-- aduana, y revende. La app reparte el costo real de cada caja entre sus
-- productos para decir a cuánto vender cada uno (ver 05_calculos.sql).
--
-- Todas las filas llevan owner_id, y cada referencia entre tablas incluye el
-- owner_id: una fila nunca puede apuntar a datos de otra cuenta.

-- ------------------------------------------------------------------ cajas
create table if not exists public.cajas (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  descripcion     text not null check (length(trim(descripcion)) > 0),
  fecha           date not null default current_date,

  -- Cada monto va en la moneda en que se pagó: lo de USA en dólares, la
  -- aduana normalmente en lempiras. Solo lo pagado en dólares usa tipo_cambio.
  lote            numeric(10,2) not null default 0 check (lote >= 0),       -- 0 si solo hubo compras en tienda
  lote_moneda     text not null default 'USD' check (lote_moneda in ('USD', 'HNL')),
  flete           numeric(10,2) not null default 0 check (flete >= 0),
  flete_moneda    text not null default 'USD' check (flete_moneda in ('USD', 'HNL')),
  aduana          numeric(10,2) not null default 0 check (aduana >= 0),
  aduana_moneda   text not null default 'HNL' check (aduana_moneda in ('USD', 'HNL')),
  otros           numeric(10,2) not null default 0 check (otros >= 0),
  otros_moneda    text not null default 'USD' check (otros_moneda in ('USD', 'HNL')),

  -- El dólar al que se pagó, no el del día: queda fijo con la caja, así los
  -- precios no cambian cada vez que se mueve el tipo de cambio.
  tipo_cambio     numeric(10,4) not null check (tipo_cambio > 0),
  margen_deseado  numeric(4,3)  not null default 0.400 check (margen_deseado >= 0),

  -- Colchón cambiario: sube el precio sugerido de la parte pagada en dólares,
  -- por si el dólar está más caro cuando toque reponer. No toca el costo real.
  colchon         numeric(4,3)  not null default 0.030 check (colchon >= 0 and colchon <= 0.5),

  creada_en       timestamptz not null default now(),

  -- Destino de las referencias que exigen el mismo dueño (ver productos).
  constraint cajas_id_dueno_unico unique (id, owner_id)
);

-- -------------------------------------------------------------- productos
create table if not exists public.productos (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  caja_id      uuid not null,
  nombre       text not null check (length(trim(nombre)) > 0),
  foto_path    text,

  -- 'tienda': valor_usd es el costo real, con recibo.
  -- 'lote'  : valor_usd es una estimación; solo se usa para repartir en
  --           proporción lo que costó el lote.
  origen       text not null check (origen in ('lote', 'tienda')),
  valor_usd    numeric(10,2) not null check (valor_usd >= 0),   -- por unidad

  cantidad     integer not null check (cantidad > 0),            -- unidades recibidas
  stock        integer not null check (stock >= 0),              -- unidades que quedan
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  precio       numeric(10,2) not null default 0 check (precio >= 0),  -- de venta, en lempiras

  creado_en    timestamptz not null default now(),

  constraint stock_no_mayor_que_cantidad check (stock <= cantidad),
  constraint productos_id_dueno_unico unique (id, owner_id),
  constraint productos_caja_del_mismo_dueno foreign key (caja_id, owner_id)
    references public.cajas (id, owner_id) on delete cascade
);

-- --------------------------------------------------------------- clientas
create table if not exists public.clientas (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  telefono   text,
  creada_en  timestamptz not null default now(),

  constraint clientas_id_dueno_unico unique (id, owner_id)
);

-- ----------------------------------------------------------------- ventas
-- Un fiado es una venta con es_fiada = true.
create table if not exists public.ventas (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clienta_id  uuid,
  descripcion text,
  canal       text not null default 'local' check (canal in ('local', 'redes')),
  es_fiada    boolean not null default false,
  total       numeric(10,2) not null check (total >= 0),
  fecha       timestamptz not null default now(),

  -- Un fiado sin clienta no se podría cobrar. Por esto mismo, una clienta con
  -- fiados no se puede borrar: se perdería a quién cobrarle.
  constraint fiada_necesita_clienta check (not es_fiada or clienta_id is not null),
  constraint ventas_id_dueno_unico unique (id, owner_id),
  constraint ventas_clienta_del_mismo_dueno foreign key (clienta_id, owner_id)
    references public.clientas (id, owner_id) on delete set null (clienta_id)
);

-- ---------------------------------------------------------- detalle_venta
create table if not exists public.detalle_venta (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  venta_id    uuid not null,
  producto_id uuid,
  cantidad    integer not null check (cantidad > 0),
  precio_unit numeric(10,2) not null check (precio_unit >= 0),

  constraint detalle_venta_del_mismo_dueno foreign key (venta_id, owner_id)
    references public.ventas (id, owner_id) on delete cascade,
  -- Si se borra el producto, la venta queda en el historial sin él.
  constraint detalle_producto_del_mismo_dueno foreign key (producto_id, owner_id)
    references public.productos (id, owner_id) on delete set null (producto_id)
);

-- ----------------------------------------------------------------- abonos
create table if not exists public.abonos (
  id       uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  venta_id uuid not null,
  monto    numeric(10,2) not null check (monto > 0),
  fecha    timestamptz not null default now(),

  constraint abonos_venta_del_mismo_dueno foreign key (venta_id, owner_id)
    references public.ventas (id, owner_id) on delete cascade
);
