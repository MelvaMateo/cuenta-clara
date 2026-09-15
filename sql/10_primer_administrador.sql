-- Cuenta Clara · 10 · Primer administrador
--
-- A los administradores los nombra otro administrador desde el portal
-- (admin.html). Al principio no hay ninguno, así que el primero se nombra acá.
--
-- Antes de correrlo, en el SQL Editor, cambiá el correo de ejemplo por el de
-- cada cuenta que va a administrar. No subas correos reales al repo: este
-- archivo queda con el de ejemplo.
--
-- La cuenta tiene que existir: si entra con Google, que inicie sesión una vez
-- en la app y después se corre esto. Idempotente: correrlo de nuevo deja lo
-- mismo. Requiere 01 a 06.
do $$
declare
  v_correos constant text[] := array['tu-correo@ejemplo.com'];
  v_correo text;
  v_id     uuid;
begin
  foreach v_correo in array v_correos loop
    select id into v_id from auth.users where lower(email) = lower(v_correo);
    if v_id is null then
      raise notice 'No existe la cuenta %: que inicie sesión una vez en la app y corré esto de nuevo.', v_correo;
      continue;
    end if;
    insert into public.estado_cuentas (user_id, es_admin, activa)
         values (v_id, true, true)
    on conflict (user_id) do update
       set es_admin = true, activa = true, actualizado_en = now()
     where not public.estado_cuentas.es_admin or not public.estado_cuentas.activa;
    raise notice 'Administrador: %', v_correo;
  end loop;
end $$;
