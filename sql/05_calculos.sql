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

-- ---------------------------------------------------------- operaciones
-- Lo que toca varias filas, o suma y resta sobre lo que ya hay, se hace con
-- una función: corre en una sola transacción, así queda todo o nada.
--
-- Todas son idempotentes. La app genera la clave de cada operación (el id de
-- la fila que va a crear) y la manda otra vez si reintenta: si la base ya la
-- había registrado, responde lo mismo sin repetirla. Si la misma clave llega
-- con otros datos, es un error y no se registra nada.
--
-- security invoker: corren con los permisos de quien las llama, así el RLS
-- solo deja tocar lo propio.

-- ------------------------------------------------------- venta de producto
-- Descuenta stock y deja registrada la venta, para que la caja sepa cuánto
-- lleva recuperado. Devuelve el stock que queda.
-- La versión anterior no tenía clave: si se cortaba la conexión después de
-- vender y se reintentaba, el stock se descontaba dos veces.
drop function if exists public.vender_producto(uuid, integer);

create or replace function public.vender_producto(p_venta uuid, p_producto uuid, p_cantidad integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_stock  integer;
  v_precio numeric(10,2);
  v_owner  uuid;
begin
  if p_venta is null then
    raise exception 'Falta la clave de la venta';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero';
  end if;

  -- Bloquea el producto hasta el final: dos ventas a la vez no pueden leer el
  -- mismo stock, y un reintento espera a que termine la primera.
  select stock, precio, owner_id into v_stock, v_precio, v_owner
    from public.productos
   where id = p_producto
     for update;
  if not found then
    raise exception 'No existe el producto';
  end if;

  -- Ya registrada con esta clave: no se vende dos veces.
  if exists (select 1 from public.ventas where id = p_venta) then
    if exists (select 1 from public.detalle_venta
                where venta_id = p_venta and producto_id = p_producto and cantidad = p_cantidad) then
      return v_stock;
    end if;
    raise exception 'Esta venta ya se registró con otros datos';
  end if;

  if v_stock < p_cantidad then
    raise exception 'No hay suficiente stock';
  end if;

  update public.productos
     set stock = stock - p_cantidad
   where id = p_producto
  returning stock into v_stock;

  insert into public.ventas (id, owner_id, total, canal, es_fiada)
       values (p_venta, v_owner, v_precio * p_cantidad, 'local', false);

  insert into public.detalle_venta (owner_id, venta_id, producto_id, cantidad, precio_unit)
       values (v_owner, p_venta, p_producto, p_cantidad, v_precio);

  return v_stock;
end $$;

-- Solo con la sesión iniciada.
revoke all on function public.vender_producto(uuid, uuid, integer) from public, anon;
grant execute on function public.vender_producto(uuid, uuid, integer) to authenticated;

-- ------------------------------------------------------------------ fiado
-- Anota un fiado y, si hace falta, la clienta: todo o nada. Antes eran dos
-- llamadas desde la app y, si fallaba la segunda, quedaba la clienta sin su
-- fiado. La clienta se reconoce por su nombre canónico, sin distinguir
-- mayúsculas: "karla  medina" es Karla Medina. La clave es el id del fiado.
-- Devuelve el id de la clienta.
create or replace function public.registrar_fiado(p_venta uuid, p_clienta text, p_descripcion text, p_total numeric)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner   uuid          := auth.uid();
  v_nombre  text          := texto_canonico(p_clienta);
  v_desc    text          := texto_canonico(p_descripcion);
  v_total   numeric(10,2) := round(p_total, 2);
  v_clienta uuid;
begin
  if p_venta is null then
    raise exception 'Falta la clave del fiado';
  end if;
  if v_owner is null then
    raise exception 'Hace falta iniciar sesión';
  end if;
  if v_nombre is null then
    raise exception 'Falta el nombre de la clienta';
  end if;
  if v_total is null or v_total <= 0 then
    raise exception 'El monto debe ser mayor que cero';
  end if;

  insert into clientas (owner_id, nombre) values (v_owner, v_nombre)
  on conflict (owner_id, lower(nombre)) do nothing;
  select id into v_clienta from clientas where owner_id = v_owner and lower(nombre) = lower(v_nombre);

  insert into ventas (id, owner_id, clienta_id, descripcion, es_fiada, total)
       values (p_venta, v_owner, v_clienta, v_desc, true, v_total)
  on conflict (id) do nothing;

  -- No entró porque la clave ya estaba: tiene que ser el mismo fiado.
  if not found and not exists (
       select 1 from ventas
        where id = p_venta and es_fiada and clienta_id = v_clienta
          and total = v_total and descripcion is not distinct from v_desc) then
    raise exception 'Este fiado ya se registró con otros datos';
  end if;

  return v_clienta;
end $$;

revoke all on function public.registrar_fiado(uuid, text, text, numeric) from public, anon;
grant execute on function public.registrar_fiado(uuid, text, text, numeric) to authenticated;

-- La API de Supabase vuelve a leer la estructura.
notify pgrst, 'reload schema';
