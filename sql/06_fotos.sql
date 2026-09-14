-- Cuenta Clara · 06 · Fotos (Supabase Storage)
--
-- Idempotente: el bucket se crea o se deja público, y cada política se borra
-- y se vuelve a crear.
--
-- El bucket es público para que las fotos se vean con su URL sin firmarla:
-- en un bucket público las descargas por URL no pasan por las políticas.
-- Las políticas controlan lo demás (listar, subir, borrar), y cada cuenta
-- solo puede hacerlo dentro de su carpeta: <uid>/<archivo>.

insert into storage.buckets (id, name, public)
     values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

-- "ver fotos" es de la versión anterior: dejaba a cualquiera listar las fotos
-- de todas las cuentas por la API de Storage. Se reemplaza por "ver fotos propias".
drop policy if exists "ver fotos"            on storage.objects;
drop policy if exists "ver fotos propias"    on storage.objects;
drop policy if exists "subir fotos propias"  on storage.objects;
drop policy if exists "borrar fotos propias" on storage.objects;

create policy "ver fotos propias" on storage.objects
  for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "subir fotos propias" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "borrar fotos propias" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = (select auth.uid())::text);
