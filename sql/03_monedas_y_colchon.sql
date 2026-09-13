-- Cuenta Clara — migración: moneda por gasto y colchón cambiario.
--
-- Solo para bases creadas con una versión anterior de 01_esquema.sql, donde
-- todos los gastos de la caja iban en dólares (columnas *_usd).
--
-- Orden:
--   1. Este archivo.
--   2. Volver a correr 01_esquema.sql: recrea las vistas con el cálculo nuevo.
--      No borra datos.
--   3. Opcional: 02_datos_muestra.sql, para ver la muestra con la aduana en lempiras.
--
-- Las cajas que ya existen quedan igual que antes: sus gastos se marcan en
-- dólares (así se cargaron) y su colchón en 0, para que ningún precio sugerido
-- cambie solo. Las cajas nuevas arrancan con la aduana en lempiras y 3% de colchón.

-- Las vistas dependen de estas columnas; se recrean en el paso 2.
drop view if exists public.productos_costeados;
drop view if exists public.cajas_resumen;
drop view if exists public.cajas_calculo;

-- Las columnas *_usd pasan a llamarse por lo que guardan: un monto, en la
-- moneda que diga su columna *_moneda. Solo si todavía tienen el nombre viejo,
-- para que correr esto dos veces no falle.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'cajas'
                and column_name = 'costo_lote_usd') then
    alter table public.cajas rename column costo_lote_usd to lote;
    alter table public.cajas rename column flete_usd      to flete;
    alter table public.cajas rename column aduana_usd     to aduana;
    alter table public.cajas rename column otros_usd      to otros;
  end if;
end $$;

alter table public.cajas
  add column if not exists lote_moneda   text not null default 'USD' check (lote_moneda   in ('USD', 'HNL')),
  add column if not exists flete_moneda  text not null default 'USD' check (flete_moneda  in ('USD', 'HNL')),
  add column if not exists aduana_moneda text not null default 'USD' check (aduana_moneda in ('USD', 'HNL')),
  add column if not exists otros_moneda  text not null default 'USD' check (otros_moneda  in ('USD', 'HNL')),
  add column if not exists colchon       numeric(4,3) not null default 0 check (colchon >= 0 and colchon <= 0.5);

-- De acá en adelante, igual que una base nueva.
alter table public.cajas
  alter column aduana_moneda set default 'HNL',
  alter column colchon       set default 0.030;
