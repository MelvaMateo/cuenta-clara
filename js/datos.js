/* Acceso a los datos en Supabase (PostgreSQL).

   Reemplaza al objeto DB que guardaba todo en localStorage: los datos ya no
   viven en el celular, se comparten entre dispositivos y quedan respaldados.
   Cada consulta devuelve solo las filas de quien inició sesión, porque las
   políticas RLS filtran por owner_id (ver sql/01_esquema.sql). */

const Datos = {

  /* ===== Inventario ===== */

  async productos() {
    const { data, error } = await sb
      .from('productos')
      .select('id, nombre, costo, precio, stock, stock_minimo')
      .order('nombre');
    if (error) throw error;
    return data;
  },

  async agregarProducto({ nombre, costo, precio, stock, stockMinimo }) {
    const { error } = await sb.from('productos').insert({
      nombre,
      costo: costo || 0,
      precio,
      stock: stock || 0,
      stock_minimo: stockMinimo || 0,
    });
    if (error) throw error;
  },

  /* El descuento de stock ocurre en la base, en una sola sentencia, para que
     no se pueda vender más de lo que hay (ver la función vender_producto). */
  async venderProducto(id, cantidad) {
    const { error } = await sb.rpc('vender_producto', { p_id: id, p_cantidad: cantidad });
    if (error) throw error;
  },

  /* ===== Fiados ===== */

  /* Lee la vista `fiados`, que ya trae el saldo calculado (total − abonos). */
  async fiados() {
    const { data, error } = await sb
      .from('fiados')
      .select('id, clienta, descripcion, total, abonado, saldo, fecha')
      .order('fecha', { ascending: false });
    if (error) throw error;
    return data;
  },

  /* Busca la clienta por nombre y la crea si no existe (caso de prueba 3 del
     PLAN). Antes el nombre era texto suelto y "Karla" y "karla" quedaban como
     dos deudoras distintas. */
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
