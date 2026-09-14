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
};

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
    }).select('id').single();
    if (error) throw error;
    return data.id;
  },

  /* El colchón solo mueve los precios sugeridos: el costo real no cambia. */
  async cambiarColchon(id, colchon) {
    const { error } = await sb.from('cajas').update({ colchon }).eq('id', id);
    if (error) throw error;
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
