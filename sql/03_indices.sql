-- Cuenta Clara · 03 · Índices
--
-- Idempotente: "if not exists". Postgres no indexa solo las claves foráneas,
-- y el RLS filtra por owner_id en cada consulta de la app: sin estos índices,
-- cada pantalla recorre la tabla entera.

-- owner_id: lo usa el RLS en todas las tablas.
create index if not exists cajas_owner_idx        on public.cajas (owner_id);
create index if not exists productos_owner_idx    on public.productos (owner_id);
create index if not exists clientas_owner_idx     on public.clientas (owner_id);
create index if not exists ventas_owner_fiada_idx on public.ventas (owner_id, es_fiada);   -- la vista de fiados
create index if not exists detalle_owner_idx      on public.detalle_venta (owner_id);
create index if not exists abonos_owner_idx       on public.abonos (owner_id);

-- Claves foráneas: los joins de las vistas y los borrados en cascada.
create index if not exists productos_caja_idx     on public.productos (caja_id);
create index if not exists ventas_clienta_idx     on public.ventas (clienta_id);
create index if not exists detalle_venta_idx      on public.detalle_venta (venta_id);
create index if not exists detalle_producto_idx   on public.detalle_venta (producto_id);
create index if not exists abonos_venta_idx       on public.abonos (venta_id);

-- "Karla" y "karla" no pueden ser dos deudoras distintas. Va sobre
-- lower(nombre) porque la app busca sin distinguir mayúsculas.
create unique index if not exists clientas_nombre_unico on public.clientas (owner_id, lower(nombre));
