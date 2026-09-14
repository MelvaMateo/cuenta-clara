/* Acceso a los datos en Supabase (PostgreSQL) y a las fotos (Storage).

   El costo real de cada producto no se guarda: lo calcula la base repartiendo
   lo que costó la caja (ver la vista productos_costeados en sql/05_calculos.sql).
   Acá solo se lee ya calculado.

   Cada consulta devuelve solo las filas de quien inició sesión, porque las
   políticas RLS filtran por owner_id. */

/* Claves de idempotencia.

   Cada operación que escribe lleva una clave (un UUID) que se genera una sola
   vez. Si la conexión se corta y no se sabe si la base alcanzó a guardar, al
   reintentar viaja la misma clave y la base no repite la operación: una venta
   no descuenta el stock dos veces.

   La clave sale de la "firma" de la operación: qué se hace, con qué datos y
   sobre qué estado (por ejemplo, el stock que se veía al vender). Reintentar
   lo mismo reusa la clave; otra operación, aunque se parezca, lleva otra: una
   vez que la venta entra, el stock cambia, y vender otra unidad es otra firma.
   La clave se suelta cuando la base confirma. */
const Claves = {
  pendientes: new Map(),

  async con(firma, operacion) {
    const llave = JSON.stringify(firma);
    if (!this.pendientes.has(llave)) this.pendientes.set(llave, crypto.randomUUID());
    const resultado = await operacion(this.pendientes.get(llave));
    this.pendientes.delete(llave);
    return resultado;
  },

  /* Un texto en la firma, como lo guarda la base: "Karla  Medina " y
     "karla medina" son la misma operación. */
  texto: s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase(),
};

const Datos = {

  /* ===== Cajas ===== */

  async cajas() {
    const { data, error } = await sb
      .from('cajas_resumen')
      .select('*')
      .order('fecha', { ascending: false })
      .order('id');                     // desempate: dos cajas del mismo día salen siempre en el mismo orden
    if (error) throw error;
    return data;
  },

  /* La clave es el id de la caja. Con "on conflict do nothing", reintentar
     con la misma clave no crea otra. */
  async agregarCaja(clave, caja) {
    const { error } = await sb.from('cajas').upsert({
      id: clave,
      descripcion: caja.descripcion,
      fecha: caja.fecha || new Date().toLocaleDateString('en-CA'),   // AAAA-MM-DD en hora local: en UTC, de noche en Honduras ya es mañana
      lote: caja.lote || 0,
      lote_moneda: caja.loteMoneda,
      flete: caja.flete || 0,
      flete_moneda: caja.fleteMoneda,
      aduana: caja.aduana || 0,
      aduana_moneda: caja.aduanaMoneda,
      otros: caja.otros || 0,
      otros_moneda: caja.otrosMoneda,
      tipo_cambio: caja.tipoCambio,
      margen_deseado: caja.margen,
      colchon: caja.colchon,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    return clave;
  },

  /* El colchón solo mueve los precios sugeridos: el costo real no cambia.
     Manda el valor final, no una diferencia: repetirlo deja lo mismo. Si no
     encuentra la caja, avisa en vez de dar el cambio por hecho. */
  async cambiarColchon(id, colchon) {
    const { data, error } = await sb.from('cajas').update({ colchon }).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No se encontró la caja: recargá la página.');
  },

  /* ===== Productos ===== */

  /* Vienen de la vista, así que traen costo_unitario y precio_sugerido ya
     calculados con el reparto de la caja. */
  async productos() {
    const { data, error } = await sb
      .from('productos_costeados')
      .select('*')
      .order('nombre')
      .order('id');
    if (error) throw error;
    return data;
  },

  /* Igual que la caja: la clave es el id del producto. */
  async agregarProducto(clave, p) {
    const { error } = await sb.from('productos').upsert({
      id: clave,
      caja_id: p.cajaId,
      nombre: p.nombre,
      origen: p.origen,
      valor_usd: p.valorUsd,
      cantidad: p.cantidad,
      stock: p.cantidad,                     // al llegar, el stock es todo lo recibido
      stock_minimo: p.stockMinimo || 0,
      precio: p.precio || 0,
      foto_path: p.fotoPath || null,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  },

  /* Igual que el colchón: el valor final, y un aviso si no está el producto. */
  async cambiarPrecio(id, precio) {
    const { data, error } = await sb.from('productos').update({ precio }).eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('No se encontró el producto: recargá la página.');
  },

  /* Descuenta stock y registra la venta en una sola transacción, para que la
     caja sepa cuánto lleva recuperado y no se pueda vender de más. La clave
     es el id de la venta. Devuelve el stock que queda. */
  async venderProducto(clave, id, cantidad) {
    const { data, error } = await sb.rpc('vender_producto', {
      p_venta: clave, p_producto: id, p_cantidad: cantidad,
    });
    if (error) throw error;
    return data;
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

  /* Cada usuaria sube dentro de su propia carpeta: el RLS del bucket lo exige.
     El nombre del archivo sale de su contenido (SHA-256): la misma foto va
     siempre al mismo lugar. Si ya estaba, porque un intento anterior subió
     pero la respuesta no llegó, se toma como subida en vez de dejar otra copia. */
  async subirFoto(file, userId) {
    const blob = await this.comprimirImagen(file);
    const huella = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const hex = [...new Uint8Array(huella)].map(b => b.toString(16).padStart(2, '0')).join('');
    const ruta = `${userId}/${hex}.jpg`;
    const { error } = await sb.storage
      .from('fotos')
      .upload(ruta, blob, { contentType: 'image/jpeg' });
    const yaEstaba = error && (String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message));
    if (error && !yaEstaba) throw error;
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
      .order('fecha', { ascending: false })
      .order('id');
    if (error) throw error;
    return data;
  },

  /* Anota el fiado y, si no existe, la clienta, en una sola transacción de la
     base. La clienta se reconoce por su nombre sin importar mayúsculas ni
     espacios: "karla  medina" es Karla Medina. La clave es el id del fiado. */
  async agregarFiado(clave, { clienta, descripcion, monto }) {
    const { error } = await sb.rpc('registrar_fiado', {
      p_venta: clave, p_clienta: clienta, p_descripcion: descripcion || null, p_total: monto,
    });
    if (error) throw error;
  },

  /* El abono y el control de no pasarse del saldo van juntos en la base. La
     clave es el id del abono. Devuelve el saldo que queda. */
  async abonar(clave, ventaId, monto) {
    const { data, error } = await sb.rpc('registrar_abono', {
      p_abono: clave, p_venta: ventaId, p_monto: monto,
    });
    if (error) throw error;
    return Number(data);
  },
};
