/* Acceso a los datos en Supabase (PostgreSQL) y a las fotos (Storage).

   El costo real de cada producto no se guarda: lo calcula la base repartiendo
   lo que costó la caja (ver la vista productos_costeados en sql/01_esquema.sql).
   Acá solo se lee ya calculado.

   Cada consulta devuelve solo las filas de quien inició sesión, porque las
   políticas RLS filtran por owner_id. */

const Datos = {

  /* ===== Cajas ===== */

  async cajas() {
    const { data, error } = await sb
      .from('cajas_resumen')
      .select('*')
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data;
  },

  async agregarCaja(caja) {
    const { data, error } = await sb.from('cajas').insert({
      descripcion: caja.descripcion,
      fecha: caja.fecha || new Date().toISOString().slice(0, 10),
      costo_lote_usd: caja.costoLote || 0,
      flete_usd: caja.flete || 0,
      aduana_usd: caja.aduana || 0,
      otros_usd: caja.otros || 0,
      tipo_cambio: caja.tipoCambio,
      margen_deseado: caja.margen,
    }).select('id').single();
    if (error) throw error;
    return data.id;
  },

  /* ===== Productos ===== */

  /* Vienen de la vista, así que traen costo_unitario y precio_sugerido ya
     calculados con el reparto de la caja. */
  async productos() {
    const { data, error } = await sb
      .from('productos_costeados')
      .select('*')
      .order('nombre');
    if (error) throw error;
    return data;
  },

  async agregarProducto(p) {
    const { error } = await sb.from('productos').insert({
      caja_id: p.cajaId,
      nombre: p.nombre,
      origen: p.origen,
      valor_usd: p.valorUsd,
      cantidad: p.cantidad,
      stock: p.cantidad,                     // al llegar, el stock es todo lo recibido
      stock_minimo: p.stockMinimo || 0,
      precio: p.precio || 0,
      foto_path: p.fotoPath || null,
    });
    if (error) throw error;
  },

  async cambiarPrecio(id, precio) {
    const { error } = await sb.from('productos').update({ precio }).eq('id', id);
    if (error) throw error;
  },

  /* Descuenta stock y registra la venta en una sola sentencia, para que la
     caja sepa cuánto lleva recuperado y no se pueda vender de más. */
  async venderProducto(id, cantidad) {
    const { error } = await sb.rpc('vender_producto', { p_id: id, p_cantidad: cantidad });
    if (error) throw error;
  },

  /* ===== Fotos ===== */

  /* Las fotos del celular pesan varios MB. Se reducen antes de subir para no
     gastarle los datos ni el almacenamiento del proyecto. */
  async comprimirImagen(file, maxLado = 1200, calidad = 0.82) {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.round(bitmap.width * escala);
    lienzo.height = Math.round(bitmap.height * escala);
    lienzo.getContext('2d').drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    bitmap.close();
    return new Promise((resolver, rechazar) => {
      lienzo.toBlob(
        b => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la foto'))),
        'image/jpeg',
        calidad
      );
    });
  },

  /* Cada usuaria sube dentro de su propia carpeta: el RLS del bucket lo exige. */
  async subirFoto(file, userId) {
    const blob = await this.comprimirImagen(file);
    const ruta = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage
      .from('fotos')
      .upload(ruta, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
    return ruta;
  },

  urlFoto(ruta) {
    if (!ruta) return null;
    return sb.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;
  },

  /* ===== Fiados ===== */

  /* La vista ya trae el saldo calculado (total − abonos). */
  async fiados() {
    const { data, error } = await sb
      .from('fiados')
      .select('id, clienta, descripcion, total, abonado, saldo, fecha')
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data;
  },

  /* Busca la clienta por nombre y la crea si no existe. Sin esto, "Karla" y
     "karla" quedarían como dos deudoras distintas. */
  async clientaPorNombre(nombre) {
    const { data, error } = await sb
      .from('clientas')
      .select('id')
      .ilike('nombre', nombre)
      .maybeSingle();
    if (error) throw error;
    if (data) return data.id;

    const { data: nueva, error: errorAlta } = await sb
      .from('clientas')
      .insert({ nombre })
      .select('id')
      .single();
    if (errorAlta) throw errorAlta;
    return nueva.id;
  },

  async agregarFiado({ clienta, descripcion, monto }) {
    const clientaId = await this.clientaPorNombre(clienta);
    const { error } = await sb.from('ventas').insert({
      clienta_id: clientaId,
      descripcion: descripcion || null,
      es_fiada: true,
      total: monto,
    });
    if (error) throw error;
  },

  async abonar(ventaId, monto) {
    const { error } = await sb.from('abonos').insert({ venta_id: ventaId, monto });
    if (error) throw error;
  },
};
