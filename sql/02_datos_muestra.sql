-- Cuenta Clara — datos de muestra para la demostración.
-- Correr después de 01_esquema.sql, en: Supabase → SQL Editor → Run.
--
-- Una caja MIXTA, como las que suelen traerse de USA: parte lote surtido (sin precios
-- por producto, valores estimados) y parte comprada en tiendas en USA (costo
-- real, con recibo). Los números son inventados pero plausibles; cambiá los
-- VALUES por los reales cuando los tengas.
--
-- Cambiá este correo si querés cargar la muestra en la otra cuenta.
do $$
declare
  v_owner  uuid;
  v_caja   uuid;
  v_karla  uuid;
  v_wendy  uuid;
  v_suyapa uuid;
  v_venta  uuid;
begin
  select id into v_owner from auth.users where email = 'odany_m@unitec.edu';
  if v_owner is null then
    raise exception 'No existe ese usuario. Revisá el correo en Authentication → Users.';
  end if;

  -- Limpio para poder correr esto más de una vez.
  delete from public.ventas   where owner_id = v_owner;
  delete from public.cajas    where owner_id = v_owner;   -- arrastra sus productos
  delete from public.clientas where owner_id = v_owner;

  -- -------------------------------------------------------------- la caja
  --   Lote surtido        $200
  --   Compras en tienda   $190   (se calcula solo desde los productos)
  --   Flete $45 + Aduana L 936.70 (se paga en lempiras) + Otros $12
  --   → traer la mercadería la encarece ~24%
  --   Colchón de 3% por si el dólar sube mientras se vende la caja.
  insert into public.cajas
    (owner_id, descripcion, fecha, lote, lote_moneda, flete, flete_moneda,
     aduana, aduana_moneda, otros, otros_moneda, tipo_cambio, margen_deseado, colchon)
  values
    (v_owner, 'Caja agosto 2026', '2026-08-14', 200.00, 'USD', 45.00, 'USD',
     936.70, 'HNL', 12.00, 'USD', 24.6500, 0.400, 0.030)
  returning id into v_caja;

  -- ------------------------------------------- comprado en tienda (costo real)
  insert into public.productos
    (owner_id, caja_id, nombre, origen, valor_usd, cantidad, stock, stock_minimo, precio) values
    (v_owner, v_caja, 'Plancha de cabello 450°F', 'tienda', 45.00, 2, 1, 1, 1900.00),
    (v_owner, v_caja, 'Set CeraVe limpiador + crema', 'tienda', 25.00, 4, 3, 2, 1050.00);

  -- --------------------------------------------- del lote (valor estimado)
  -- No se sabe cuánto costó cada cosa: se estima cuánto vale. Solo importan
  -- las proporciones — el total queda anclado a los $200 que sí pagó.
  insert into public.productos
    (owner_id, caja_id, nombre, origen, valor_usd, cantidad, stock, stock_minimo, precio) values
    (v_owner, v_caja, 'Cartera sintética negra',   'lote', 30.00,  2, 2, 1,  850.00),
    (v_owner, v_caja, 'Paleta de sombras 18 tonos','lote', 18.00,  3, 1, 2,  520.00),
    (v_owner, v_caja, 'Sérum vitamina C 30 ml',    'lote', 12.00,  4, 4, 2,  360.00),
    (v_owner, v_caja, 'Cepillo desenredante',      'lote',  7.00,  6, 5, 2,  210.00),
    (v_owner, v_caja, 'Organizador acrílico',      'lote',  8.00,  5, 5, 2,  150.00),  -- ¡bajo el costo!
    (v_owner, v_caja, 'Labial mate surtido',       'lote',  6.00, 10, 8, 3,  180.00);

  -- El organizador quedó a L 150 y su costo real ronda L 161: la app lo va a
  -- marcar como venta con pérdida. Es justo el error que hoy no puede ver.

  -- ------------------------------------------------------ ventas de contado
  -- Dan el "recuperado" de la caja. La cantidad coincide con cantidad − stock.
  insert into public.ventas (owner_id, total, canal, es_fiada, fecha)
       values (v_owner, 1900.00, 'local', false, now() - interval '9 days')
    returning id into v_venta;
  insert into public.detalle_venta (owner_id, venta_id, producto_id, cantidad, precio_unit)
       select v_owner, v_venta, id, 1, 1900.00 from public.productos
        where caja_id = v_caja and nombre = 'Plancha de cabello 450°F';

  insert into public.ventas (owner_id, total, canal, es_fiada, fecha)
       values (v_owner, 1050.00, 'redes', false, now() - interval '5 days')
    returning id into v_venta;
  insert into public.detalle_venta (owner_id, venta_id, producto_id, cantidad, precio_unit)
       select v_owner, v_venta, id, 1, 1050.00 from public.productos
        where caja_id = v_caja and nombre = 'Set CeraVe limpiador + crema';

  insert into public.ventas (owner_id, total, canal, es_fiada, fecha)
       values (v_owner, 1400.00, 'local', false, now() - interval '3 days')
    returning id into v_venta;
  insert into public.detalle_venta (owner_id, venta_id, producto_id, cantidad, precio_unit) values
    (v_owner, v_venta, (select id from public.productos where caja_id = v_caja and nombre = 'Paleta de sombras 18 tonos'), 2, 520.00),
    (v_owner, v_venta, (select id from public.productos where caja_id = v_caja and nombre = 'Labial mate surtido'),        2, 180.00);

  insert into public.ventas (owner_id, total, canal, es_fiada, fecha)
       values (v_owner, 210.00, 'local', false, now() - interval '1 day')
    returning id into v_venta;
  insert into public.detalle_venta (owner_id, venta_id, producto_id, cantidad, precio_unit)
       select v_owner, v_venta, id, 1, 210.00 from public.productos
        where caja_id = v_caja and nombre = 'Cepillo desenredante';

  -- ------------------------------------------------------------- clientas
  insert into public.clientas (owner_id, nombre, telefono)
       values (v_owner, 'Karla Medina', '9712-5805') returning id into v_karla;
  insert into public.clientas (owner_id, nombre, telefono)
       values (v_owner, 'Wendy Cruz', '3345-1120')   returning id into v_wendy;
  insert into public.clientas (owner_id, nombre, telefono)
       values (v_owner, 'Suyapa Banegas', null)      returning id into v_suyapa;

  -- ---------------------------------------------------- fiados (productos)
  -- 1) Con abono parcial: saldo 850 − 300 = 550
  insert into public.ventas (owner_id, clienta_id, descripcion, es_fiada, total, fecha)
       values (v_owner, v_karla, 'Cartera sintética negra', true, 850.00, now() - interval '12 days')
    returning id into v_venta;
  insert into public.abonos (owner_id, venta_id, monto, fecha)
       values (v_owner, v_venta, 300.00, now() - interval '4 days');

  -- 2) Sin abonos: saldo 1,050
  insert into public.ventas (owner_id, clienta_id, descripcion, es_fiada, total, fecha)
       values (v_owner, v_wendy, 'Set CeraVe limpiador + crema', true, 1050.00, now() - interval '6 days');

  -- 3) Ya pagado: debe verse como PAGADO
  insert into public.ventas (owner_id, clienta_id, descripcion, es_fiada, total, fecha)
       values (v_owner, v_suyapa, 'Sérum vitamina C 30 ml', true, 360.00, now() - interval '20 days')
    returning id into v_venta;
  insert into public.abonos (owner_id, venta_id, monto, fecha) values
    (v_owner, v_venta, 200.00, now() - interval '15 days'),
    (v_owner, v_venta, 160.00, now() - interval '9 days');

  raise notice 'Listo: 1 caja mixta con 8 productos, 4 ventas y 3 fiados (uno pagado).';
end $$;

-- Para revisar que el cálculo dé lo esperado:
--   select descripcion, invertido, factor, valor_venta, vendido,
--          falta_recuperar, ganancia_proyectada from public.cajas_resumen;
--   select nombre, origen, costo_unitario, precio, precio_sugerido
--     from public.productos_costeados order by costo_unitario desc;
