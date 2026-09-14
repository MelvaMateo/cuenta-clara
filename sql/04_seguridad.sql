-- Cuenta Clara · 04 · Seguridad de las tablas
--
-- Idempotente: activar RLS dos veces no cambia nada, y cada política se
-- borra y se vuelve a crear con su definición actual.
--
-- Cada cuenta ve y cambia solo sus filas. La app siempre consulta con la
-- sesión iniciada (rol authenticated); sin sesión (rol anon) no hay acceso.

alter table public.cajas         enable row level security;
alter table public.productos     enable row level security;
alter table public.clientas      enable row level security;
alter table public.ventas        enable row level security;
alter table public.detalle_venta enable row level security;
alter table public.abonos        enable row level security;

-- El (select auth.uid()) se evalúa una sola vez por consulta, no por fila.
do $$
declare
  t text;
begin
  foreach t in array array['cajas', 'productos', 'clientas', 'ventas', 'detalle_venta', 'abonos'] loop
    execute format('drop policy if exists "solo lo propio" on public.%I', t);
    execute format($f$
      create policy "solo lo propio" on public.%I
        for all to authenticated
        using (owner_id = (select auth.uid()))
        with check (owner_id = (select auth.uid()))
    $f$, t);
  end loop;
end $$;

-- Permisos explícitos: la sesión iniciada trabaja con sus filas (el RLS
-- decide cuáles); sin sesión, nada. El RLS ya lo impedía, pero así no
-- depende de una sola barrera.
grant select, insert, update, delete
  on public.cajas, public.productos, public.clientas, public.ventas, public.detalle_venta, public.abonos
  to authenticated;
revoke all
  on public.cajas, public.productos, public.clientas, public.ventas, public.detalle_venta, public.abonos
  from anon;
