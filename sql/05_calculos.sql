-- Cuenta Clara · 05 · Cálculos
--
-- Las vistas que calculan cuánto costó de verdad cada producto, el resumen de
-- cada caja y los saldos de los fiados, más la función de venta.
-- Idempotente: cada vista se borra y se vuelve a crear; la función usa
-- "create or replace".
--
-- security_invoker: las vistas respetan el RLS de quien consulta. Sin esto,
-- cualquiera vería las cajas de todas las cuentas.
--
-- Todo se lleva a lempiras: lo pagado en dólares se convierte con el
-- tipo_cambio de la caja y lo pagado en lempiras entra tal cual.

drop view if exists public.productos_costeados;
drop view if exists public.cajas_resumen;
drop view if exists public.cajas_calculo;
drop view if exists public.fiados;

-- ------------------------------------------------ las cuentas de cada caja
-- Una sola vista hace las cuentas; las otras dos la usan, así la fórmula vive
-- en un solo lugar.
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

-- --------------------------------------------------- resumen de cada caja
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

-- --------------------------------------- costo y precio de cada producto
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

-- ------------------------------------------------------ saldos de fiados
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

grant select on public.cajas_calculo, public.cajas_resumen, public.productos_costeados, public.fiados
  to authenticated;
revoke all on public.cajas_calculo, public.cajas_resumen, public.productos_costeados, public.fiados
  from anon;

-- ------------------------------------------------------- venta de producto
-- Descuenta stock y deja registrada la venta, para que la caja sepa cuánto
-- lleva recuperado. El "where stock >= cantidad" hace imposible vender de más.
-- security invoker: corre con los permisos de quien la llama, así el RLS
-- solo le deja vender sus propios productos.
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

-- Solo con la sesión iniciada. Antes cualquiera con la llave pública podía
-- llamarla (el RLS no la dejaba tocar nada, pero respondía).
revoke all on function public.vender_producto(uuid, integer) from public, anon;
grant execute on function public.vender_producto(uuid, integer) to authenticated;

-- La API de Supabase vuelve a leer la estructura.
notify pgrst, 'reload schema';
