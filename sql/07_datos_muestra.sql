-- Cuenta Clara · 07 · Datos de muestra (opcional)
--
-- Una caja MIXTA como las que se traen de USA: parte lote surtido (sin precio
-- por producto, valores estimados) y parte comprada en tiendas (costo real,
-- con recibo). Los números son inventados pero plausibles.
--
-- Idempotente y sin efectos sobre lo demás:
--   · cada fila de la muestra tiene un id fijo, derivado de la cuenta: correrlo
--     de nuevo la deja igual en vez de duplicarla, y devuelve stock y precios
--     de la muestra a su valor inicial;
--   · no borra ni cambia nada que se haya cargado desde la app;
--   · si la cuenta tenía la muestra de la versión anterior de este script
--     (con ids al azar), la reemplaza.
-- Las fechas son fijas, no relativas a hoy, para que cada corrida dé lo mismo.
--
-- Requiere 01 a 05. Cambiá el correo (v_correo) para cargarla en otra cuenta.

-- Id estable de cada fila de la muestra, distinto para cada cuenta.
create or replace function pg_temp.id_muestra(dueno uuid, clave text)
returns uuid language sql immutable
as $$ select md5(dueno::text || ':cuenta-clara-muestra:' || clave)::uuid $$;

do $$
declare
  v_correo constant text := 'odany_m@unitec.edu';
  v_owner  uuid;
  v_caja   uuid;
  v_karla  uuid;
  v_wendy  uuid;
  v_suyapa uuid;
  v_ventas uuid[];
begin
  select id into v_owner from auth.users where email = v_correo;
  if v_owner is null then
    raise exception 'No existe el usuario %. Revisá el correo en Authentication → Users.', v_correo;
  end if;

  v_caja := pg_temp.id_muestra(v_owner, 'caja');
  v_ventas := array(select pg_temp.id_muestra(v_owner, k)
                      from unnest(array['venta-1', 'venta-2', 'venta-3', 'venta-4',
                                        'fiado-karla', 'fiado-wendy', 'fiado-suyapa']) as k);

  -- ------------------------- 1. la muestra de la versión anterior del script
  -- Se reconoce por sus valores exactos; no hay otra forma porque tenía ids al azar.
  delete from public.cajas c
   where c.owner_id = v_owner and c.id <> v_caja
     and c.descripcion = 'Caja agosto 2026' and c.fecha = date '2026-08-14'
     and c.tipo_cambio = 24.65 and c.lote = 200 and c.flete = 45 and c.otros = 12;

  -- Sus ventas de contado quedaron sin producto al borrarse la caja.
  delete from public.ventas v
   where v.owner_id = v_owner and v.id <> all (v_ventas)
     and not v.es_fiada and v.descripcion is null
     and (v.canal, v.total) in (('local', 1900.00), ('redes', 1050.00), ('local', 1400.00), ('local', 210.00))
     and not exists (select 1 from public.detalle_venta d where d.venta_id = v.id and d.producto_id is not null);

  delete from public.ventas v
   using public.clientas cl
   where v.owner_id = v_owner and v.id <> all (v_ventas) and v.es_fiada and cl.id = v.clienta_id
     and (cl.nombre, v.descripcion, v.total) in (('Karla Medina',   'Cartera sintética negra',      850.00),
                                                  ('Wendy Cruz',     'Set CeraVe limpiador + crema', 1050.00),
                                                  ('Suyapa Banegas', 'Sérum vitamina C 30 ml',        360.00));

  -- ---------------------------------------------------------------- 2. la caja
  --   Lote surtido $200 · compras en tienda $190 (salen de los productos)
  --   Flete $45 · aduana L 936.70 (en lempiras) · otros $12 · dólar a 24.65
  --   → traer la mercadería la encarece ~24%. Colchón de 3%.
  insert into public.cajas
    (id, owner_id, descripcion, fecha, lote, lote_moneda, flete, flete_moneda,
     aduana, aduana_moneda, otros, otros_moneda, tipo_cambio, margen_deseado, colchon)
  values
    (v_caja, v_owner, 'Caja agosto 2026', date '2026-08-14', 200.00, 'USD', 45.00, 'USD',
     936.70, 'HNL', 12.00, 'USD', 24.6500, 0.400, 0.030)
  on conflict (id) do update set
    descripcion = excluded.descripcion, fecha = excluded.fecha,
    lote = excluded.lote,     lote_moneda = excluded.lote_moneda,
    flete = excluded.flete,   flete_moneda = excluded.flete_moneda,
    aduana = excluded.aduana, aduana_moneda = excluded.aduana_moneda,
    otros = excluded.otros,   otros_moneda = excluded.otros_moneda,
    tipo_cambio = excluded.tipo_cambio, margen_deseado = excluded.margen_deseado,
    colchon = excluded.colchon;

  -- ----------------------------------------------------------- 3. productos
  -- 'tienda': costo real. 'lote': valor estimado; solo importan las
  -- proporciones, el total queda anclado a los $200 del lote.
  -- El organizador queda a L 150 con un costo real de ~L 161: la app lo marca
  -- como venta con pérdida.
  insert into public.productos
    (id, owner_id, caja_id, nombre, origen, valor_usd, cantidad, stock, stock_minimo, precio)
  select pg_temp.id_muestra(v_owner, 'producto:' || m.clave), v_owner, v_caja,
         m.nombre, m.origen, m.valor, m.cantidad, m.stock, m.minimo, m.precio
  from (values
    ('plancha',     'Plancha de cabello 450°F',     'tienda', 45.00,  2, 1, 1, 1900.00),
    ('cerave',      'Set CeraVe limpiador + crema', 'tienda', 25.00,  4, 3, 2, 1050.00),
    ('cartera',     'Cartera sintética negra',      'lote',   30.00,  2, 2, 1,  850.00),
    ('paleta',      'Paleta de sombras 18 tonos',   'lote',   18.00,  3, 1, 2,  520.00),
    ('serum',       'Sérum vitamina C 30 ml',       'lote',   12.00,  4, 4, 2,  360.00),
    ('cepillo',     'Cepillo desenredante',         'lote',    7.00,  6, 5, 2,  210.00),
    ('organizador', 'Organizador acrílico',         'lote',    8.00,  5, 5, 2,  150.00),
    ('labial',      'Labial mate surtido',          'lote',    6.00, 10, 8, 3,  180.00)
  ) as m(clave, nombre, origen, valor, cantidad, stock, minimo, precio)
  on conflict (id) do update set
    caja_id = excluded.caja_id, nombre = excluded.nombre, origen = excluded.origen,
    valor_usd = excluded.valor_usd, cantidad = excluded.cantidad, stock = excluded.stock,
    stock_minimo = excluded.stock_minimo, precio = excluded.precio;

  -- --------------------------------------------------- 4. ventas de contado
  -- Dan lo recuperado de la caja. Lo vendido coincide con cantidad − stock.
  insert into public.ventas (id, owner_id, total, canal, es_fiada, fecha)
  select pg_temp.id_muestra(v_owner, m.clave), v_owner, m.total, m.canal, false, m.fecha
  from (values
    ('venta-1', 1900.00, 'local', timestamptz '2026-08-20 10:30:00-06'),
    ('venta-2', 1050.00, 'redes', timestamptz '2026-08-24 16:00:00-06'),
    ('venta-3', 1400.00, 'local', timestamptz '2026-08-26 11:15:00-06'),
    ('venta-4',  210.00, 'local', timestamptz '2026-08-28 15:40:00-06')
  ) as m(clave, total, canal, fecha)
  on conflict (id) do update set
    total = excluded.total, canal = excluded.canal, es_fiada = false,
    fecha = excluded.fecha, clienta_id = null, descripcion = null;

  insert into public.detalle_venta (id, owner_id, venta_id, producto_id, cantidad, precio_unit)
  select pg_temp.id_muestra(v_owner, m.clave), v_owner,
         pg_temp.id_muestra(v_owner, m.venta),
         pg_temp.id_muestra(v_owner, 'producto:' || m.producto),
         m.cantidad, m.precio
  from (values
    ('detalle-1', 'venta-1', 'plancha', 1, 1900.00),
    ('detalle-2', 'venta-2', 'cerave',  1, 1050.00),
    ('detalle-3', 'venta-3', 'paleta',  2,  520.00),
    ('detalle-4', 'venta-3', 'labial',  2,  180.00),
    ('detalle-5', 'venta-4', 'cepillo', 1,  210.00)
  ) as m(clave, venta, producto, cantidad, precio)
  on conflict (id) do update set
    venta_id = excluded.venta_id, producto_id = excluded.producto_id,
    cantidad = excluded.cantidad, precio_unit = excluded.precio_unit;

  -- ------------------------------------------------------------ 5. clientas
  -- Si ya hay alguien con ese nombre (cargado desde la app o por la versión
  -- anterior), se usa esa fila en vez de crear otra.
  insert into public.clientas (id, owner_id, nombre, telefono) values
    (pg_temp.id_muestra(v_owner, 'clienta:karla'),  v_owner, 'Karla Medina',   '9712-5805'),
    (pg_temp.id_muestra(v_owner, 'clienta:wendy'),  v_owner, 'Wendy Cruz',     '3345-1120'),
    (pg_temp.id_muestra(v_owner, 'clienta:suyapa'), v_owner, 'Suyapa Banegas', null)
  on conflict do nothing;

  select id into v_karla  from public.clientas where owner_id = v_owner and lower(nombre) = 'karla medina';
  select id into v_wendy  from public.clientas where owner_id = v_owner and lower(nombre) = 'wendy cruz';
  select id into v_suyapa from public.clientas where owner_id = v_owner and lower(nombre) = 'suyapa banegas';

  -- ---------------------------------------------------- 6. fiados y abonos
  --   Karla: 850 − 300 = 550 · Wendy: 1,050 sin abonos · Suyapa: pagado
  insert into public.ventas (id, owner_id, clienta_id, descripcion, es_fiada, total, fecha) values
    (pg_temp.id_muestra(v_owner, 'fiado-karla'),  v_owner, v_karla,  'Cartera sintética negra',      true,  850.00, timestamptz '2026-08-17 12:00:00-06'),
    (pg_temp.id_muestra(v_owner, 'fiado-wendy'),  v_owner, v_wendy,  'Set CeraVe limpiador + crema', true, 1050.00, timestamptz '2026-08-23 12:00:00-06'),
    (pg_temp.id_muestra(v_owner, 'fiado-suyapa'), v_owner, v_suyapa, 'Sérum vitamina C 30 ml',       true,  360.00, timestamptz '2026-08-15 12:00:00-06')
  on conflict (id) do update set
    clienta_id = excluded.clienta_id, descripcion = excluded.descripcion,
    es_fiada = true, total = excluded.total, fecha = excluded.fecha;

  insert into public.abonos (id, owner_id, venta_id, monto, fecha) values
    (pg_temp.id_muestra(v_owner, 'abono-karla-1'),  v_owner, pg_temp.id_muestra(v_owner, 'fiado-karla'),  300.00, timestamptz '2026-08-25 12:00:00-06'),
    (pg_temp.id_muestra(v_owner, 'abono-suyapa-1'), v_owner, pg_temp.id_muestra(v_owner, 'fiado-suyapa'), 200.00, timestamptz '2026-08-20 12:00:00-06'),
    (pg_temp.id_muestra(v_owner, 'abono-suyapa-2'), v_owner, pg_temp.id_muestra(v_owner, 'fiado-suyapa'), 160.00, timestamptz '2026-08-26 12:00:00-06')
  on conflict (id) do update set
    venta_id = excluded.venta_id, monto = excluded.monto, fecha = excluded.fecha;

  raise notice 'Muestra lista en %: 1 caja, 8 productos, 4 ventas de contado y 3 fiados (uno pagado).', v_correo;
end $$;
