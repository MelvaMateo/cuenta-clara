-- Cuenta Clara — datos de muestra para la demostración.
-- Correr después de 01_esquema.sql, en: Supabase → SQL Editor → Run.
--
-- Los productos y las clientas son INVENTADOS, con precios plausibles para un
-- salón de Choloma en lempiras. Reemplazalos por los reales de Yaleni cuando
-- los tengas: lo único que hay que cambiar son los VALUES de más abajo.
--
-- Cambiá este correo si querés cargar la muestra en la otra cuenta.
do $$
declare
  v_owner   uuid;
  v_caja    uuid;
  v_karla   uuid;
  v_wendy   uuid;
  v_suyapa  uuid;
  v_venta   uuid;
begin
  select id into v_owner from auth.users where email = 'odany_m@unitec.edu';
  if v_owner is null then
    raise exception 'No existe ese usuario. Revisá el correo en Authentication → Users.';
  end if;

  -- Sin datos previos, para poder correr esto más de una vez.
  delete from public.ventas    where owner_id = v_owner;
  delete from public.productos where owner_id = v_owner;
  delete from public.clientas  where owner_id = v_owner;
  delete from public.cajas     where owner_id = v_owner;

  -- ------------------------------------------------------------------ caja
  insert into public.cajas (owner_id, descripcion, fecha, costo_total_usd, tipo_cambio)
  values (v_owner, 'Caja de agosto — productos de cabello', '2026-08-14', 320.00, 24.6500)
  returning id into v_caja;

  -- ------------------------------------------------------------- productos
  insert into public.productos (owner_id, caja_id, nombre, costo, precio, stock, stock_minimo) values
    (v_owner, v_caja, 'Tinte rubio ceniza',        180.00, 320.00,  6, 2),
    (v_owner, v_caja, 'Shampoo matizador 300 ml',  210.00, 380.00,  1, 3),  -- bajo stock
    (v_owner, v_caja, 'Keratina 500 ml',           340.00, 590.00,  4, 2),
    (v_owner, v_caja, 'Acondicionador reparador',  150.00, 260.00,  9, 3),
    (v_owner, v_caja, 'Tratamiento capilar ampolla',  45.00,  95.00, 24, 6),
    (v_owner, v_caja, 'Esmalte gel rojo',           70.00, 140.00,  2, 4),  -- bajo stock
    (v_owner, null,   'Secadora de cabello 1800W', 950.00, 1500.00, 2, 1);

  -- -------------------------------------------------------------- clientas
  insert into public.clientas (owner_id, nombre, telefono)
       values (v_owner, 'Karla Medina', '9712-5805') returning id into v_karla;
  insert into public.clientas (owner_id, nombre, telefono)
       values (v_owner, 'Wendy Cruz',   '3345-1120') returning id into v_wendy;
  insert into public.clientas (owner_id, nombre, telefono)
       values (v_owner, 'Suyapa Banegas', null)      returning id into v_suyapa;

  -- ---------------------------------------------- fiados (ventas fiadas)
  -- 1) Fiado con un abono parcial: saldo 450 − 200 = 250
  insert into public.ventas (owner_id, clienta_id, descripcion, es_fiada, total, fecha)
       values (v_owner, v_karla, 'Tinte y tratamiento', true, 450.00, now() - interval '12 days')
       returning id into v_venta;
  insert into public.abonos (owner_id, venta_id, monto, fecha)
       values (v_owner, v_venta, 200.00, now() - interval '4 days');

  -- 2) Fiado sin abonos: saldo 590
  insert into public.ventas (owner_id, clienta_id, descripcion, es_fiada, total, fecha)
       values (v_owner, v_wendy, 'Keratina 500 ml', true, 590.00, now() - interval '6 days');

  -- 3) Fiado ya pagado: saldo 0, debe verse como PAGADO
  insert into public.ventas (owner_id, clienta_id, descripcion, es_fiada, total, fecha)
       values (v_owner, v_suyapa, 'Esmalte gel y lima', true, 180.00, now() - interval '20 days')
       returning id into v_venta;
  insert into public.abonos (owner_id, venta_id, monto, fecha) values
    (v_owner, v_venta, 100.00, now() - interval '15 days'),
    (v_owner, v_venta,  80.00, now() - interval '9 days');

  -- ------------------------------------------- una venta de contado (US5)
  insert into public.ventas (owner_id, clienta_id, descripcion, canal, es_fiada, total, fecha)
       values (v_owner, null, 'Acondicionador reparador', 'redes', false, 260.00, now() - interval '2 days')
       returning id into v_venta;
  insert into public.detalle_venta (owner_id, venta_id, producto_id, cantidad, precio_unit)
  select v_owner, v_venta, id, 1, 260.00
    from public.productos
   where owner_id = v_owner and nombre = 'Acondicionador reparador';

  raise notice 'Listo: 7 productos, 3 clientas, 3 fiados (uno pagado) y 1 venta de contado.';
end $$;
