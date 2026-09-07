/* Credenciales del proyecto de Supabase.

   La publishable key es pública por diseño: viaja al navegador en cualquier
   app de Supabase. Lo que protege los datos no es esconderla, sino las
   políticas RLS de la base. La que NUNCA va acá es la secret / service_role.

   Se sacan de: Supabase → Project Settings → API. */

const SUPABASE_URL = 'https://cwnwcbrtvpfemqrcbcku.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KN_JNcgvKkJKwM4qAO2DHQ_3Y7jVx2k';

/* Mientras queden los valores de ejemplo, el login avisa en pantalla en vez
   de fallar en silencio. */
const CONFIG_LISTA =
  !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON-KEY');
