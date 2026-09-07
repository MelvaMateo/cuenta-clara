/* Credenciales del proyecto de Supabase.

   La anon key es pública por diseño: viaja al navegador en cualquier app de
   Supabase. Lo que protege los datos no es esconderla, sino las políticas RLS
   de la base. La que NUNCA va acá es la service_role key.

   Se sacan de: Supabase → Project Settings → API. */

const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';

/* Mientras queden los valores de ejemplo, el login avisa en pantalla en vez
   de fallar en silencio. */
const CONFIG_LISTA =
  !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON-KEY');
