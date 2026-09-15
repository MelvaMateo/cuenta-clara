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
alter table public.estado_cuentas enable row level security;

-- ---------------------------------------------- roles y cuentas desactivadas
-- es_admin() y cuenta_activa() leen estado_cuentas con los permisos de su
-- dueño (security definer), así una política puede preguntar por el rol sin
-- que el RLS de esa tabla se meta en el medio. Solo responden sí o no sobre la
-- propia cuenta. Una cuenta desactivada deja de ser administradora.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select es_admin and activa from public.estado_cuentas where user_id = auth.uid()), false) $$;

create or replace function public.cuenta_activa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select activa from public.estado_cuentas where user_id = auth.uid()), true) $$;

revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;
revoke all on function public.cuenta_activa() from public, anon;
grant execute on function public.cuenta_activa() to authenticated;

-- El (select auth.uid()) se evalúa una sola vez por consulta, no por fila.
-- Una cuenta desactivada desde el portal administrativo no ve ni cambia nada.
do $$
declare
  t text;
begin
  foreach t in array array['cajas', 'productos', 'clientas', 'ventas', 'detalle_venta', 'abonos'] loop
    execute format('drop policy if exists "solo lo propio" on public.%I', t);
    execute format($f$
      create policy "solo lo propio" on public.%I
        for all to authenticated
        using (owner_id = (select auth.uid()) and (select public.cuenta_activa()))
        with check (owner_id = (select auth.uid()) and (select public.cuenta_activa()))
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

-- estado_cuentas: cada cuenta ve su propia fila, y un administrador ve todas.
-- Nadie la escribe directo, ni siquiera un administrador: la cambian las
-- funciones del portal (05_calculos.sql), que dejan registro de quién y cuándo.
drop policy if exists "la propia, o todas si es admin" on public.estado_cuentas;
create policy "la propia, o todas si es admin" on public.estado_cuentas
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.es_admin()));

revoke all on public.estado_cuentas from anon, authenticated;
grant select on public.estado_cuentas to authenticated;
