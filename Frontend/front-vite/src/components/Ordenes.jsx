import React, { useEffect, useState, useMemo } from "react";
import MenuLateral from './MenuLateral';
import ResultModal from './ResultModal';
import SearchableSelect from './SearchableSelect';
import ConfirmModal from './ConfirmModal';
import { usePermission } from '../auth/PermissionContext';
import { hasPermission } from '../utils/permissions';

const API_URL = "http://localhost:5000/ordenes";
const DISPOSITIVOS_URL = "http://localhost:5000/dispositivos";
const TECNICOS_URL = "http://localhost:5000/empleadosTecnicos";
const CLIENTES_URL = "http://localhost:5000/clientes";
const TIPOS_DOC_URL = "http://localhost:5000/tipos-documento";
const ESTADOS_URL = "http://localhost:5000/estados";
const REPUESTOS_PROVEEDORES_URL = "http://localhost:5000/repuestos-proveedores";
const SERVICIOS_URL = "http://localhost:5000/servicios";

function Ordenes() {
  const permCtx = usePermission();
  const identity = permCtx ? permCtx.identity : null;
  // permiso 29 = ver/listar ordenes (route); reserve 30..32 for create/modify/delete
  const canView = hasPermission(identity, 29);
  const canCreate = hasPermission(identity, 30);
  const canModify = hasPermission(identity, 31);
  const _canDelete = hasPermission(identity, 32);
  const isSalesAdmin = identity?.idCargo === 3; // Asistente de ventas -> idCargo 3
  const isTecnico = identity?.idCargo === 2; // Técnico -> idCargo 2
  const isPurchaseAdmin = identity?.idCargo === 3; // Administrador de compras -> idCargo 3 (mismo que asistente de ventas en esta app)
  // Nota: 'Atención al público' no se usa aquí — solo Asistente de ventas (idCargo === 3) mostrará el comprobante.
  const [showOnlyEnDiagnostico, setShowOnlyEnDiagnostico] = useState(false);
  const [showOnlyEnReparacion, setShowOnlyEnReparacion] = useState(false);
  const [showOnlyPendienteAprobacion, setShowOnlyPendienteAprobacion] = useState(false);
  const [showOnlyPendienteRetiro, setShowOnlyPendienteRetiro] = useState(false);
  const [ordenes, setOrdenes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [clientes, setClientes] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [dispositivos, setDispositivos] = useState([]);
  const [tiposDoc, setTiposDoc] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [repuestosProveedores, setRepuestosProveedores] = useState([]);

  const [_mensaje, setMensaje] = useState("");
  const [formErrors, setFormErrors] = useState({});

  const [modalVisible, setModalVisible] = useState(false);
  const [modalModo, setModalModo] = useState('alta');
  const [presupuestoModalVisible, setPresupuestoModalVisible] = useState(false);
  const [presupuestoDetalles, setPresupuestoDetalles] = useState([]);
  const [presupuestoCalc, setPresupuestoCalc] = useState(0);
  const [presupuestoNroOrden, setPresupuestoNroOrden] = useState(null);

  // Helper: normalize string, remove accents/diacritics, whitespace and lower-case
  const _normalize = (s) => {
    if (!s && s !== 0) return '';
    try {
      return String(s)
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/\s+/g, '')
        .toLowerCase();
    } catch (e) {
      // Fallback for environments without unicode property escapes
      return String(s)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '')
        .toLowerCase();
    }
  };

  // Helper for search: normalize but preserve spaces (so we can tokenize by words)
  const _normalizeForSearch = (s) => {
    if (!s && s !== 0) return '';
    try {
      return String(s)
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim();
    } catch (e) {
      return String(s)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    }
  };

  // Helper para comprobar si un estado corresponde a "PendienteDeRetiro" o "Retirada"
  const isRetiroEstado = (estado) => {
    if (!estado) return false;
    const n = _normalize(estado);
    return n === 'pendientederetiro' || n === 'retirada';
  };

  const [proveedoresFiltrados, setProveedoresFiltrados] = useState([]);

  const [modalMensaje, setModalMensaje] = useState(null);
  const [modalMensajeGlobal, setModalMensajeGlobal] = useState(null);
  const [isSavingOrden, setIsSavingOrden] = useState(false);
  const [isConfirmingOrden, setIsConfirmingOrden] = useState(false);
  const [isMarkingAbandoned, setIsMarkingAbandoned] = useState(false);
  const [markingRetiradaOrden, setMarkingRetiradaOrden] = useState(null); // Guarda el nro de orden siendo procesada
  const [acceptingPresupuestoOrden, setAcceptingPresupuestoOrden] = useState(null); // Guarda el nro de orden siendo procesada
  const [rejectingPresupuestoOrden, setRejectingPresupuestoOrden] = useState(null); // Guarda el nro de orden siendo procesada
  const [showMarkAbandonedModal, setShowMarkAbandonedModal] = useState(false);
  const [terminarModalOpen, setTerminarModalOpen] = useState(false);
  const [terminarOrden, setTerminarOrden] = useState(null);
  const [terminarComentario, setTerminarComentario] = useState("");
  const [terminarSending, setTerminarSending] = useState(false);
  const [terminarReparadaSending, setTerminarReparadaSending] = useState(false);
  const [terminarNoReparadaSending, setTerminarNoReparadaSending] = useState(false);
  // Estado para el modal de "Actualizar historial" (desde la tabla)
  const [showActualizarHistorialModal, setShowActualizarHistorialModal] = useState(false);
  const [actualizarHistorialOrden, setActualizarHistorialOrden] = useState(null);
  const [actualizarHistorialTexto, setActualizarHistorialTexto] = useState('');
  const [showAddDetalle, setShowAddDetalle] = useState(false);
  const [availableRepuestos, setAvailableRepuestos] = useState([]); // <-- repuestos filtrados por servicio

  const [form, setForm] = useState({
    nroDeOrden: null,
    idDispositivo: "",
    fecha: new Date().toISOString().split('T')[0],
    descripcionDanos: "",
    diagnostico: "",
    presupuesto: 0,
    idEmpleado: "",
    estado: "EnDiagnostico" // Estado por defecto
  });
  const [resultModal, setResultModal] = useState({ open: false, success: true, title: '', message: '' });

  // Helper para notificar cambios de estado de una orden de forma consistente
  const notifyEstadoCambio = (nro, nuevoEstado, viejoEstado = null, options = {}) => {
    try {
      const readableNuevo = String(nuevoEstado || '').replace(/([A-Z])/g, ' $1').trim();
      const readableViejo = viejoEstado ? String(viejoEstado).replace(/([A-Z])/g, ' $1').trim() : null;
      const message = readableViejo
        ? `Orden #${nro}: ${readableViejo} → ${readableNuevo}`
        : `Orden #${nro} ahora está en estado: ${readableNuevo}`;

      // Mensaje global en la UI principal
      setMensaje(message);

      // Si estamos dentro de un modal o se solicita, mostrar también el mensaje en el modal
      if (options.inModal) {
        setModalMensaje({ tipo: 'success', texto: message });
      }
      // refrescar la lista si se pidió
      if (options.refresh !== false) fetchOrdenes();
    } catch (e) {
      console.error('notifyEstadoCambio error', e);
    }
  };

  const [detalles, setDetalles] = useState([]);
  const [nuevoDetalle, setNuevoDetalle] = useState({
    codigoServicio: "",
    codigoRepuesto: "",
    repuestoProveedor: "", // "codRepuesto/cuitProveedor"
    costoServicio: "",
    costoRepuesto: "",
    subtotal: ""
  });
  const [editingDetalleId, setEditingDetalleId] = useState(null);

  // Para registrar avances técnicos
  const [avances, setAvances] = useState([]);
  const [nuevoAvance, setNuevoAvance] = useState("");

  const [showAddClienteModal, setShowAddClienteModal] = useState(false);
  const [showAddDispositivoModal, setShowAddDispositivoModal] = useState(false);
  const [nuevoCliente, setNuevoCliente] = useState({ idTipoDoc: "", numeroDoc: "", nombre: "", apellido: "", telefono: "", mail: "", activo: 1 });
  const [nuevoDispositivo, setNuevoDispositivo] = useState({ nroSerie: "", marca: "", modelo: "", idCliente: "", activo: 1 });
  const [nuevoClienteErrors, setNuevoClienteErrors] = useState({});
  const [nuevoDispositivoErrors, setNuevoDispositivoErrors] = useState({});
  const [nuevoDetalleErrors, setNuevoDetalleErrors] = useState({}); // Agregar esta línea si no está presente (después de const [nuevoDispositivoErrors, setNuevoDispositivoErrors] = useState({});)
  const [isSavingCliente, setIsSavingCliente] = useState(false);
  const [isSavingDispositivo, setIsSavingDispositivo] = useState(false);
  const [isSavingHistorial, setIsSavingHistorial] = useState(false);

  // State for preserving form data when redirecting
  const [preservedFormData, setPreservedFormData] = useState(null);
  const [redirectAfterAdd, setRedirectAfterAdd] = useState(null); // 'cliente' or 'dispositivo'

  // --- Carga de Datos ---
  const fetchOrdenes = () => {
    // Include session id header when available so backend can restrict orders to the logged-in technician
    const idSesionHeader = localStorage.getItem('idSesion');
    const headers = idSesionHeader ? { 'X-Id-Sesion': idSesionHeader } : {};

    fetch(API_URL, { headers })
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) return setOrdenes([]);
        // sort by nroDeOrden descending (numeric)
        const sorted = data.slice().sort((a, b) => {
          const na = Number(a?.nroDeOrden ?? 0);
          const nb = Number(b?.nroDeOrden ?? 0);
          return nb - na;
        });
        setOrdenes(sorted);
      })
      .catch(err => { console.warn('Ordenes: fetchOrdenes error', err); setMensaje("Error al cargar órdenes"); });
  };

  // Cargar tipos de documento (igual que en Clientes.jsx)
  const fetchTiposDocumento = () => {
    fetch(TIPOS_DOC_URL)
      .then(res => res.json())
      .then(data => setTiposDoc(Array.isArray(data) ? data : []))
      .catch(err => { console.warn('Ordenes: fetchTiposDocumento error', err); setMensaje("Error al cargar tipos de documento"); });
  };

  const fetchServicios = () => {
    fetch(SERVICIOS_URL)
      .then(res => res.json())
      .then(data => setServicios(Array.isArray(data) ? data : []))
      .catch(err => { console.warn('Ordenes: fetchServicios error', err); setMensaje("Error al cargar servicios"); });
  };

  const fetchRepuestosProveedores = () => {
    fetch(REPUESTOS_PROVEEDORES_URL)
      .then(res => res.json())
      .then(data => setRepuestosProveedores(Array.isArray(data) ? data : []))
      .catch(err => { console.warn('Ordenes: fetchRepuestos error', err); setMensaje("Error al cargar repuestos"); });
  };

  useEffect(() => {
    if (canView) fetchOrdenes();
    fetchClientes();
    fetchTecnicos();
    fetchDispositivos();
    fetchTiposDocumento();
    fetchServicios();
    fetchRepuestosProveedores();
  }, [canView]);

  // Auto limpiar mensaje global después de unos segundos para que no quede persistente
  useEffect(() => {
    if (!_mensaje) return;
    // Si el modal global ya contiene una lista de órdenes marcadas, no la sobrescribimos
    // y sólo limpiamos el texto `_mensaje` tras el timeout (no cerramos el modal automáticamente).
    if (modalMensajeGlobal && Array.isArray(modalMensajeGlobal.markedOrders) && modalMensajeGlobal.markedOrders.length > 0) {
      const t = setTimeout(() => {
        setMensaje('');
        // no cerrar modal si contiene la lista marcada; el usuario lo cerrará manualmente
      }, 6000);
      return () => clearTimeout(t);
    }

    // Mostrar en modal global y limpiar estado _mensaje
    setModalMensajeGlobal({ tipo: 'info', texto: _mensaje });
    const t = setTimeout(() => {
      setMensaje('');
      setModalMensajeGlobal(null);
    }, 6000);
    return () => clearTimeout(t);
  }, [_mensaje]);

  const fetchClientes = () => {
    fetch(CLIENTES_URL)
      .then(res => res.json())
      .then(data => setClientes(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching clientes:", err));
  };

  const fetchTecnicos = () => {
    fetch(TECNICOS_URL)
      .then(res => res.json())
      .then(data => setEmpleados(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching tecnicos:", err));
  };

  const fetchDispositivos = () => {
    fetch(DISPOSITIVOS_URL)
      .then(res => res.json())
      .then(data => setDispositivos(Array.isArray(data) ? data : []))
      .catch(err => console.error("Error fetching dispositivos:", err));
  };

  // --- Presupuesto autocalculado ---
  const presupuestoTotal = useMemo(() => {
    return detalles.reduce((total, det) => total + parseFloat(det.subtotal || 0), 0);
  }, [detalles]);

  useEffect(() => {
    if (modalVisible) {
      setForm(prev => ({ ...prev, presupuesto: presupuestoTotal }));
    }
  }, [presupuestoTotal, modalVisible]);


  // --- Validaciones ---
  // handleChange is used by some inputs; keep definition
  const _handleChange = e => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setFormErrors(validarOrden({ ...form, [e.target.name]: e.target.value }));
  };

  function validarOrden(form) {
    const errors = {};
    if (!form.idDispositivo) errors.idDispositivo = "Debe seleccionar un dispositivo.";
    if (!form.descripcionDanos || form.descripcionDanos.trim().length < 10) errors.descripcionDanos = "La descripción de daños es obligatoria y debe tener al menos 10 caracteres.";
    // En creación (modalModo 'alta') la fecha la asigna el servidor; solo validar formato si existe
    if (form.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) errors.fecha = "La fecha debe tener formato YYYY-MM-DD.";
    if (!form.idEmpleado) errors.idEmpleado = "Debe seleccionar un empleado.";
    if (form.presupuesto != null && (isNaN(form.presupuesto) || Number(form.presupuesto) < 0)) errors.presupuesto = "El presupuesto debe ser un número válido (>= 0).";
    return errors;
  }

  // --- Validaciones Cliente y Dispositivo ---
  function validarDocumento(tipo, numero) {
    const tipoDocObj = tiposDoc.find(td => String(td.idTipoDoc) === String(tipo));
    const tipoNombre = tipoDocObj ? tipoDocObj.nombre : '';
    if (tipoNombre === "DNI") return /^\d{7,8}$/.test(numero);
    if (tipoNombre === "CUIT" || tipoNombre === "CUIL") return /^\d{11}$/.test(numero);
    if (tipoNombre === "PASAPORTE") return /^[A-Z0-9]{6,9}$/.test(numero);
    return true;
  }

  function validarCliente(form) {
    const errors = {};
    if (!form.idTipoDoc) errors.idTipoDoc = "Debe seleccionar el tipo de documento.";
    if (!form.numeroDoc || !validarDocumento(form.idTipoDoc, form.numeroDoc)) errors.numeroDoc = "Número de documento inválido para el tipo seleccionado.";
    if (!form.nombre || form.nombre.trim().length < 2 || !/^[a-zA-Z\s]+$/.test(form.nombre.trim())) errors.nombre = "El nombre es obligatorio, debe contener solo letras y espacios, y tener al menos 2 caracteres.";
    if (!form.apellido || form.apellido.trim().length < 2 || !/^[a-zA-Z\s]+$/.test(form.apellido.trim())) errors.apellido = "El apellido es obligatorio, debe contener solo letras y espacios, y tener al menos 2 caracteres.";
    if (!form.telefono || form.telefono.trim().length < 6 || !/^\d{6,}$/.test(form.telefono.trim())) errors.telefono = "El teléfono es obligatorio, debe contener solo números y tener al menos 6 dígitos.";
    if (!form.mail || !/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(form.mail)) errors.mail = "El email no es válido.";
    return errors;
  }

  function validarDispositivo(form) {
    const errors = {};
    if (!form.nroSerie || form.nroSerie.trim().length < 3) errors.nroSerie = "El número de serie es obligatorio y debe tener al menos 3 caracteres.";
    if (!form.marca || form.marca.trim().length < 2) errors.marca = "La marca es obligatoria y debe tener al menos 2 caracteres.";
    if (!form.modelo || form.modelo.trim().length < 2) errors.modelo = "El modelo es obligatorio y debe tener al menos 2 caracteres.";
    if (!form.idCliente) errors.idCliente = "Debe seleccionar un cliente válido.";
    return errors;
  }

  function validarNuevoDetalle(detalle) {
    const errors = {};
    if (!detalle.codigoServicio) errors.codigoServicio = "Debe seleccionar un servicio.";
    if (!detalle.codigoRepuesto) errors.codigoRepuesto = "Debe seleccionar un repuesto.";
    if (!detalle.repuestoProveedor) errors.repuestoProveedor = "Debe seleccionar un proveedor.";
    if (detalle.costoServicio == null || isNaN(detalle.costoServicio) || Number(detalle.costoServicio) < 0) errors.costoServicio = "Costo de servicio inválido.";
    if (detalle.costoRepuesto == null || isNaN(detalle.costoRepuesto) || Number(detalle.costoRepuesto) < 0) errors.costoRepuesto = "Costo de repuesto inválido.";
    if (detalle.subtotal == null || isNaN(detalle.subtotal) || Number(detalle.subtotal) < 0) errors.subtotal = "Subtotal inválido.";
    return errors;
  }

  // Functions to handle adding new cliente/dispositivo with form preservation
  const handleAddDispositivo = () => {
    setPreservedFormData({ ...form, detalles: [...detalles] });
    setRedirectAfterAdd('dispositivo');
    setShowAddDispositivoModal(true);
  };

  const handleAddCliente = () => {
    setPreservedFormData({ ...form, detalles: [...detalles] });
    setRedirectAfterAdd('cliente');
    setShowAddClienteModal(true);
  };

  // --- Manejadores de Modal ---
  const handleModalClose = () => {
    setModalVisible(false);
    setNuevoDetalleErrors({}); // Limpiar errores de detalles al cerrar modal
  };

  const handleAgregarClick = () => {
    if (!canCreate) { setMensaje('No tenés permiso para crear órdenes.'); return; }
    setModalModo('alta');
    setForm({
      nroDeOrden: null,
      idDispositivo: "",
      fecha: new Date().toISOString().split('T')[0],
      descripcionDanos: "",
      diagnostico: "",
      presupuesto: 0,
      idEmpleado: "",
      estado: "En Diagnóstico" // Mostrar estado legible para el usuario
    });
    setDetalles([]);
    setFormErrors({});
    setMensaje("");
    setModalVisible(true);
    setShowAddDetalle(true); // abrir formulario al crear
    setAvailableRepuestos([]);
    setProveedoresFiltrados([]);
    setNuevoDetalle({ codigoServicio: "", codigoRepuesto: "", repuestoProveedor: "", costoServicio: "", costoRepuesto: "", subtotal: "" });
    setEditingDetalleId(null);
  };

  // En handleModificar, cambiar setShowAddDetalle(false) a setShowAddDetalle(true) para permitir añadir detalles en modificar
  const handleModificar = (orden) => {
    // Allow Técnicos (idCargo === 2) to modify even if they don't have the canModify permiso,
    // but only when the order is in Diagnóstico or Reparación. Otherwise open in consulta.
    if (!canModify && !isTecnico) {
      setModalModo('consultar');
      setModalVisible(true);
      setForm({ ...orden });
      setMensaje('No tenés permiso para modificar órdenes. Abriendo en modo consulta.');
      return;
    }

    if (isTecnico) {
      const est = _normalize(orden.estado || '');
      const allowedForTecnico = est.includes('diagnost') || est.includes('reparacion');
      if (!allowedForTecnico && !canModify) {
        // Técnicos no pueden modificar órdenes que no estén en diagnóstico o reparación
        setModalModo('consultar');
        setModalVisible(true);
        setForm({ ...orden });
        setMensaje('No podés modificar esta orden: sólo se pueden modificar órdenes en Diagnóstico o Reparación. Abriendo en modo consulta.');
        return;
      }
    }
    // Configura el modal en modo modificar y carga detalles
    setModalModo('modificar');
    setForm({
      nroDeOrden: orden.nroDeOrden,
      idDispositivo: orden.idDispositivo || "",
      fecha: orden.fecha,
      descripcionDanos: orden.descripcionDanos || "",
      diagnostico: orden.diagnostico || "",
      presupuesto: orden.presupuesto || 0,
      idEmpleado: orden.idEmpleado || "",
      estado: orden.estado || form.estado
    });

    fetch(`${API_URL}/${orden.nroDeOrden}/detalles`)
      .then(res => {
        if (!res.ok) {
          console.error(`Error ${res.status} al obtener detalles`);
          return [];
        }
        return res.json();
      })
      .then(data => {
        console.log("Detalles obtenidos:", data);
        setDetalles(Array.isArray(data) ? data.map(d => ({
          ...d,
          isNew: false,
          codRepuestos: d.codRepuestos ?? (d.repuesto ? d.repuesto.idRepuesto : null),
          cuitProveedor: d.cuitProveedor ?? (d.proveedor ? d.proveedor.cuil : null),
          repuestoDescripcion: d.repuestoDescripcion ?? (d.repuesto ? `${d.repuesto.marca || ''} ${d.repuesto.modelo || ''}`.trim() : ''),
          proveedorRazonSocial: d.proveedorRazonSocial ?? (d.proveedor ? d.proveedor.razonSocial : ''),
        })) : []);
      })
      .catch(err => {
        console.error("Error al obtener detalles:", err);
        setDetalles([]);
      })
      .finally(() => {
        setFormErrors({});
        setMensaje("");
        setModalVisible(true);
          // Mostrar formulario de agregar detalle solo si no es Asistente de ventas
          setShowAddDetalle(!isSalesAdmin);
        setAvailableRepuestos([]);
        setProveedoresFiltrados([]);
        setEditingDetalleId(null);
      });
  };

  const handleGenerarPDF = (nroDeOrden) => {
    if (!canView) { setMensaje('No tenés permiso para generar PDF de órdenes.'); return; }
    // Abrir la página de previsualización en una nueva ventana
    window.open(`${API_URL}/${nroDeOrden}/preview`, '_blank', 'width=1000,height=800');
  };

  const handleGenerarComprobante = (nroDeOrden) => {
    if (isTecnico) { setMensaje('Acción no disponible para técnicos.'); return; }
    if (!canView) { setMensaje('No tenés permiso para generar comprobantes.'); return; }
    // Abrir preview del comprobante — similar comportamiento al PDF de la orden
    window.open(`${API_URL}/${nroDeOrden}/comprobante-retiro/preview`, '_blank', 'width=900,height=700');
  };

  // Abrir modal de calcular presupuesto (solo frontend: trae detalles y calcula total)
  const handleAbrirCalcularPresupuesto = (orden) => {
    const nro = orden.nroDeOrden;
    setPresupuestoNroOrden(nro);
    // Intentar obtener detalles via endpoint existente
    fetch(`${API_URL}/${nro}`)
      .then(res => {
        if (!res.ok) return Promise.reject(new Error('No se pudo obtener la orden'));
        return res.json();
      })
      .then(data => {
        const detalles = Array.isArray(data.detalles) ? data.detalles : (data.detalles || []);
        setPresupuestoDetalles(detalles);
        // calcular total sumando los subtotales
        const total = detalles.reduce((s, d) => s + Number(d.subtotal || 0), 0);
        setPresupuestoCalc(total);
        setPresupuestoModalVisible(true);
      })
      .catch(err => {
        console.error('Error al obtener detalles para presupuesto:', err);
        setPresupuestoDetalles([]);
        setPresupuestoCalc(0);
        setPresupuestoModalVisible(true);
      });
  };

  const handleMarcarRetirada = (nro) => {
    if (!nro) return;
    setMarkingRetiradaOrden(nro);
    // Llamamos al nuevo endpoint que marca la orden como Retirada
    fetch(`${API_URL}/${nro}/marcar-retirada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: identity?.nombre || 'web' })
    })
      .then(async res => {
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} ${txt}`);
        }
        return res.json().catch(() => ({}));
      })
      .then(data => {
        // Usar notificación consistente
        const nuevoEstado = (data && data.estado) ? data.estado : 'Retirada';
        notifyEstadoCambio(nro, nuevoEstado, null, { refresh: true });
      })
      .catch(err => {
        console.error('Error al marcar retirada:', err);
        setMensaje(`No se pudo marcar retirada: ${err.message}`);
        setModalMensaje({ tipo: 'danger', texto: `No se pudo marcar retirada: ${err.message}` });
      })
      .finally(() => {
        setMarkingRetiradaOrden(null);
      });
  };

    // Abre el modal de confirmación para marcar órdenes abandonadas
    const handleMarkAbandoned = () => {
      if (!isSalesAdmin) { setMensaje('No tenés permiso para esta acción.'); return; }
      setShowMarkAbandonedModal(true);
    };

    // Confirma y ejecuta la acción de marcar órdenes abandonadas
    const confirmMarkAbandoned = async () => {
      setShowMarkAbandonedModal(false);
      setIsMarkingAbandoned(true);
      try {
        const resp = await fetch(`${API_URL}/mark-abandoned`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: 30 })
        });
        let data = null;
        try { data = await resp.json(); } catch (e) { data = null; }
        if (!resp.ok) {
          const txt = (data && data.error) ? data.error : (await resp.text().catch(() => ''));
          throw new Error(txt || `HTTP ${resp.status}`);
        }
  const changed = data && (data.changed || 0);
  const marked = data && Array.isArray(data.marked) ? data.marked : [];
  // Mostrar modal global con lista de órdenes marcadas (si las hay)
  setMensaje(`Se marcaron ${changed} órdenes como Abandonada.`);
  setModalMensajeGlobal({ tipo: 'success', texto: `Se marcaron ${changed} órdenes como Abandonada.`, markedOrders: marked });
  // refrescar lista
  fetchOrdenes();
      } catch (err) {
        console.error('confirmMarkAbandoned error:', err);
        setModalMensaje({ tipo: 'danger', texto: err.message || 'Error al marcar órdenes como abandonadas' });
      } finally {
        setIsMarkingAbandoned(false);
      }
    };

  // Acciones desde el modal de presupuesto para administradores de ventas
  const handlePresupuestoAceptar = (nro) => {
    console.log('Llamando a aceptar presupuesto para orden', nro);
    setAcceptingPresupuestoOrden(nro);
    fetch(`${API_URL}/${nro}/presupuesto/aceptar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: identity?.nombre || 'admin' })
    })
      .then(async res => {
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.error('Respuesta no OK:', res.status, txt);
          throw new Error(`HTTP ${res.status} ${txt}`);
        }
        // Intentar parsear JSON de forma segura
        return res.json().catch(() => ({}));
      })
      .then(data => {
        console.log('Respuesta aceptar presupuesto:', data);
        if (data && data.success) {
          const nuevoEstado = data.estado || 'En Reparación';
          notifyEstadoCambio(nro, nuevoEstado, null, { inModal: true, refresh: true });
          setPresupuestoModalVisible(false);
        } else {
          setModalMensaje({ tipo: 'danger', texto: data.error || 'No se pudo aceptar el presupuesto.' });
        }
      })
      .catch(err => {
        console.error('Error aceptar presupuesto:', err);
        setModalMensaje({ tipo: 'danger', texto: `Error al aceptar presupuesto: ${err.message || err}` });
      })
      .finally(() => {
        setAcceptingPresupuestoOrden(null);
      });
  };

  const handlePresupuestoRechazar = (nro) => {
    console.log('Llamando a rechazar presupuesto para orden', nro);
    setRejectingPresupuestoOrden(nro);
    fetch(`${API_URL}/${nro}/presupuesto/rechazar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: identity?.nombre || 'admin' })
    })
      .then(async res => {
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          console.error('Respuesta no OK:', res.status, txt);
          throw new Error(`HTTP ${res.status} ${txt}`);
        }
        return res.json().catch(() => ({}));
      })
      .then(data => {
        console.log('Respuesta rechazar presupuesto:', data);
        if (data && data.success) {
          const nuevoEstado = data.estado || 'PendienteDeRetiro';
          notifyEstadoCambio(nro, nuevoEstado, null, { inModal: true, refresh: true });
          setPresupuestoModalVisible(false);
        } else {
          setModalMensaje({ tipo: 'danger', texto: data.error || 'No se pudo rechazar el presupuesto.' });
        }
      })
      .catch(err => {
        console.error('Error rechazar presupuesto:', err);
        setModalMensaje({ tipo: 'danger', texto: `Error al rechazar presupuesto: ${err.message || err}` });
      })
      .finally(() => {
        setRejectingPresupuestoOrden(null);
      });
  };

  const handleConsultar = (orden) => {
    if (!canView) { setMensaje('No tenés permiso para ver órdenes.'); return; }
    setModalModo('consultar');
    setForm({
      nroDeOrden: orden.nroDeOrden,
      idDispositivo: orden.idDispositivo || "",
      fecha: orden.fecha,
      descripcionDanos: orden.descripcionDanos || "",
      diagnostico: orden.diagnostico || "",
      estado: orden.estado || "",
      presupuesto: orden.presupuesto || 0,
      idEmpleado: orden.idEmpleado || ""
    });
    fetch(`${API_URL}/${orden.nroDeOrden}/detalles`)
      .then(res => {
        if (!res.ok) {
          console.error(`Error ${res.status} al obtener detalles`);
          return []; // Devolver array vacío en caso de error
        }
        return res.json();
      })
      .then(data => {
        console.log("Detalles obtenidos:", data);
        setDetalles(Array.isArray(data) ? data.map(d => ({
          ...d,
          isNew: false,
          codRepuestos: d.codRepuestos ?? (d.repuesto ? d.repuesto.idRepuesto : null),
          cuitProveedor: d.cuitProveedor ?? (d.proveedor ? d.proveedor.cuil : null),
          repuestoDescripcion: d.repuestoDescripcion ?? (d.repuesto ? `${d.repuesto.marca || ''} ${d.repuesto.modelo || ''}`.trim() : ''),
          proveedorRazonSocial: d.proveedorRazonSocial ?? (d.proveedor ? d.proveedor.razonSocial : ''),
        })) : []);
      })
      .catch(err => {
        console.error("Error al obtener detalles:", err);
        setDetalles([]);
      });

    // Cargar actualizaciones si existe el endpoint
    fetch(`${API_URL}/${orden.nroDeOrden}/actualizaciones`)
      .then(res => res.json())
      .then(setAvances)
      .catch(err => { console.warn('Ordenes: fetch avances error', err); setAvances([]); });

    setFormErrors({});
    setMensaje("");
    setModalVisible(true);
    setShowAddDetalle(false);
    setAvailableRepuestos([]);
    setProveedoresFiltrados([]);
    setEditingDetalleId(null);
    // Además, intentar obtener la orden completa para campos como fechaInicioRetiro
    fetch(`${API_URL}/${orden.nroDeOrden}`)
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(data => {
        // data puede ser el detalle completo
        if (data) {
          setForm(prev => ({ ...prev, fechaInicioRetiro: data.fechaInicioRetiro || prev.fechaInicioRetiro, estado: data.estado || prev.estado }));
          // Prefill de campos de UI de envío removido (no se setean destinatarios desde aquí)
        }
      })
      .catch(err => {
        // No crítico
        console.debug('No se pudo obtener orden completa:', err);
      });
  };

  // --- Confirmación de Presupuesto ---
  // Reemplaza la función confirmarPresupuesto existente por esta
  const confirmarPresupuesto = (aceptado) => {
    if (!canModify) { setModalMensaje({ tipo: 'warning', texto: 'No tenés permiso para confirmar presupuestos.' }); return; }
    fetch(`http://localhost:5000/ordenes/${form.nroDeOrden}/confirmacion-presupuesto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aceptado, usuario: "encargado1" })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const nuevoEstado = data.nuevoEstado || (aceptado ? 'En Reparación' : 'PendienteDeRetiro');
          notifyEstadoCambio(form.nroDeOrden, nuevoEstado, form.estado, { inModal: true, refresh: true });
          setForm(prev => ({ ...prev, estado: nuevoEstado }));
        } else {
          setModalMensaje({ tipo: 'danger', texto: data.error || 'Ocurrió un error' });
        }
      })
      .catch((err) => {
        setModalMensaje({ tipo: 'danger', texto: 'Error de red: ' + (err?.message || '') });
      });
  };

  // --- Registro de avances técnicos ---
  const _registrarAvance = (e) => {
    e.preventDefault();

    // Validación básica
    if (!nuevoAvance.trim()) {
      setModalMensaje({
        tipo: 'warning',
        texto: 'Debe ingresar una descripción del avance'
      });
      return;
    }

    console.log("Enviando avance:", nuevoAvance); // Debug

    // Permitir a los técnicos registrar avances aunque no tengan el permiso canModify
    if (!isTecnico && !canModify) {
      setModalMensaje({
        tipo: 'warning',
        texto: 'No tenés permiso para registrar avances.'
      });
      return;
    }

    fetch(`http://localhost:5000/ordenes/${form.nroDeOrden}/actualizaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descripcion: nuevoAvance,
        usuario: identity?.nombre || "web" // Usar el nombre del usuario actual
      })
    })
      .then(res => {
        console.log("Respuesta del servidor:", res.status); // Debug
        if (!res.ok) {
          throw new Error(`Error al registrar avance: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        console.log("Datos del servidor:", data); // Debug

        if (data.success) {
          // Limpiar el campo
          setNuevoAvance("");

          // Mostrar mensaje de éxito dentro del modal
          setModalMensaje({
            tipo: 'success',
            texto: "Avance registrado correctamente"
          });

          // Cargar avances inmediatamente después del registro exitoso
          console.log("Recargando avances para orden:", form.nroDeOrden); // Debug

          fetch(`http://localhost:5000/ordenes/${form.nroDeOrden}/actualizaciones`)
            .then(res => {
              console.log("Respuesta de carga de avances:", res.status); // Debug
              if (!res.ok) {
                throw new Error("Error al cargar avances");
              }
              return res.json();
            })
            .then(data => {
              console.log("Avances cargados:", data); // Debug
              setAvances(data);
            })
            .catch(err => {
              console.error("Error al cargar avances:", err);
              setModalMensaje({
                tipo: 'warning',
                texto: "Avance registrado pero no se pudieron cargar las actualizaciones"
              });
            });
        } else {
          setModalMensaje({
            tipo: 'danger',
            texto: data.error || "Error al registrar el avance"
          });
        }
      })
      .catch(err => {
        console.error("Error en registrarAvance:", err); // Debug
        setModalMensaje({
          tipo: 'danger',
          texto: err.message
        });
      });
  };


  // Función para cargar avances
  const _cargarAvances = () => {
    const url = `http://localhost:5000/ordenes/${form.nroDeOrden}/actualizaciones`;

    // Mostrar indicador de carga (opcional)
    // setModalMensaje({ tipo: 'info', texto: 'Cargando avances...' });

    fetch(url)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Error HTTP: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        setAvances(Array.isArray(data) ? data : []);

        // Opcional: mostrar mensaje solo si no hay mensaje de éxito ya visible
        if (!modalMensaje || modalMensaje.tipo !== 'success') {
          setModalMensaje({
            tipo: 'info',
            texto: data.length > 0
              ? `${data.length} avances registrados para esta orden`
              : 'No hay avances registrados para esta orden'
          });
        }
      })
      .catch(err => {
        console.error("Error al cargar avances:", err);
        setModalMensaje({
          tipo: 'warning',
          texto: `No se pudieron cargar los avances: ${err.message}`
        });
      });
  };

  // Cargar historial de avances para una orden específica desde la tabla (En Reparación)
  const handleActualizarHistorialRow = (nro) => {
    // Mostrar indicador de carga en la UI principal
    setMensaje('Actualizando historial de avances...');
    fetch(`${API_URL}/${nro}/actualizaciones`)
      .then(res => {
        if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
        return res.json();
      })
      .then(data => {
        // Mostrar feedback al usuario con la cantidad de avances encontrados
        const count = Array.isArray(data) ? data.length : 0;
        setMensaje(`Historial actualizado para orden #${nro}. Encontrados ${count} avances.`);
        // opcional: log para depuración
        console.debug(`Avances para orden ${nro}:`, data);
      })
      .catch(err => {
        console.error('Error al actualizar historial desde la tabla:', err);
        setMensaje(`Error al actualizar historial de la orden #${nro}: ${err.message}`);
      });
  };

  // --- Manejadores de Formularios ---
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setFormErrors(validarOrden({ ...form, [name]: value })); // Agrega validación en tiempo real
  };

  const handleNuevoDetalleChange = (e) => {
    const { name, value } = e.target;
    let updatedDetalle = { ...nuevoDetalle, [name]: value };

    // Cuando cambia el servicio -> pedir repuestos asociados al servicio al backend
    if (name === "codigoServicio") {
      const servicioCodigo = value;
      if (servicioCodigo) {
        // Usar URL correcta sin "ordenes/" en la ruta
        fetch(`http://localhost:5000/servicios/${encodeURIComponent(servicioCodigo)}/repuestos`)
          .then(res => res.ok ? res.json() : Promise.reject(res))
          .then(data => {
            console.log("Repuestos obtenidos:", data); // depuración
            setAvailableRepuestos(Array.isArray(data) ? data : []);
            setProveedoresFiltrados([]);
            // autocalcular costo servicio si existe en servicios
            const servicioSeleccionado = servicios.find(s => String(s.idServicio ?? s.id ?? s.codigo) === String(servicioCodigo));
            updatedDetalle.costoServicio = servicioSeleccionado ? parseFloat(servicioSeleccionado.precioBase ?? 0) : 0;
            updatedDetalle.codigoRepuesto = "";
            updatedDetalle.repuestoProveedor = "";
            setNuevoDetalle(updatedDetalle);
            
            // Limpiar error de servicio si hay errores previos
            if (Object.keys(nuevoDetalleErrors).length > 0) {
              const updatedErrors = { ...nuevoDetalleErrors };
              delete updatedErrors.codigoServicio;
              setNuevoDetalleErrors(updatedErrors);
            }
          })
          .catch(err => {
            console.error("Error al cargar repuestos:", err);
            setAvailableRepuestos([]);
            setProveedoresFiltrados([]);
            updatedDetalle.costoServicio = 0;
            updatedDetalle.codigoRepuesto = "";
            updatedDetalle.repuestoProveedor = "";
            setNuevoDetalle(updatedDetalle);
            
            // Limpiar error de servicio si hay errores previos (incluso si falla el fetch)
            if (Object.keys(nuevoDetalleErrors).length > 0) {
              const updatedErrors = { ...nuevoDetalleErrors };
              delete updatedErrors.codigoServicio;
              setNuevoDetalleErrors(updatedErrors);
            }
          });
      } else {
        setAvailableRepuestos([]);
        setProveedoresFiltrados([]);
        updatedDetalle.codigoRepuesto = "";
        updatedDetalle.repuestoProveedor = "";
        updatedDetalle.costoServicio = 0;
        setNuevoDetalle(updatedDetalle);
      }
      return;
    }

    // Si cambió el repuesto -> cargar proveedores desde availableRepuestos (respuesta del backend)
    if (name === "codigoRepuesto") {
      const codRepuesto = value;
      let encontrado = null;
      if (availableRepuestos && availableRepuestos.length > 0) {
        encontrado = availableRepuestos.find(r => String(r.idRepuesto) === String(codRepuesto));
      }
      if (!encontrado) {
        // fallback local: repuestosProveedores is a flat list of relations
        // build a proveedores array from matching relations
        const relacionados = repuestosProveedores.filter(rp => String(rp.idRepuesto) === String(codRepuesto) || String(rp.codigoRepuesto) === String(codRepuesto));
        if (relacionados.length > 0) {
          const provs = relacionados.map(rp => ({
            idProveedor: rp.idProveedor ?? rp.idProveedor,
            cuilProveedor: rp.cuilProveedor ?? rp.cuil ?? null,
            razonSocial: rp.razonSocial ?? `Proveedor ${rp.idProveedor}`,
            costo: rp.costo ?? 0
          }));
          setProveedoresFiltrados(provs);
        } else {
          setProveedoresFiltrados([]);
        }
      } else {
        if (encontrado && Array.isArray(encontrado.proveedores)) {
          setProveedoresFiltrados(encontrado.proveedores);
        } else {
          setProveedoresFiltrados([]);
        }
      }
      updatedDetalle.repuestoProveedor = "";
      updatedDetalle.costoRepuesto = "";
    }

    // --- lógica de autocompletar costos (como ya tenías) ---
    let costoServ = parseFloat(updatedDetalle.costoServicio || 0);
    let costoRep = parseFloat(updatedDetalle.costoRepuesto || 0);

    if (name === "codigoServicio") {
      const servicioSeleccionado = servicios.find(s => s.idServicio?.toString() === value);
      costoServ = servicioSeleccionado ? parseFloat(servicioSeleccionado.precioBase) : 0;
      updatedDetalle.costoServicio = costoServ;
    }

    if (name === "repuestoProveedor") {
      const [codRepuesto, cuilProv] = value.split('/');
      let costoEncontrado = 0;
      if (codRepuesto && cuilProv) {
        const prov = proveedoresFiltrados.find(p => String(p.cuilProveedor) === String(cuilProv) || String(p.idProveedor) === String(cuilProv));
        costoEncontrado = prov ? parseFloat(prov.costo || 0) : 0;
      }
      updatedDetalle.costoRepuesto = costoEncontrado;
    }

    costoRep = parseFloat(updatedDetalle.costoRepuesto || 0);
    updatedDetalle.subtotal = costoServ + costoRep;

    setNuevoDetalle(updatedDetalle);
    
    // Limpiar errores solo si ya se intentó agregar antes (si hay errores previos)
    if (Object.keys(nuevoDetalleErrors).length > 0) {
      const updatedErrors = { ...nuevoDetalleErrors };
      
      // Limpiar error de servicio si se seleccionó
      if (updatedDetalle.codigoServicio) {
        delete updatedErrors.codigoServicio;
      }
      
      // Limpiar error de repuesto si se seleccionó
      if (updatedDetalle.codigoRepuesto) {
        delete updatedErrors.codigoRepuesto;
      }
      
      // Limpiar error de proveedor si se seleccionó
      if (updatedDetalle.repuestoProveedor) {
        delete updatedErrors.repuestoProveedor;
      }
      
      setNuevoDetalleErrors(updatedErrors);
    }
  };

  // Solicitar aprobación: cambiar estado a PendienteDeAprobacion
  const handleSolicitarAprobacion = (nro) => {
    fetch(`${API_URL}/${nro}/solicitar-aprobacion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.success) {
          const nuevoEstado = data.estado || 'PendienteDeAprobacion';
          notifyEstadoCambio(nro, nuevoEstado, form.estado, { inModal: true, refresh: true });
          // actualizar estado local del form para reflejar el cambio
          setForm(prev => ({ ...prev, estado: nuevoEstado }));
        } else {
          setModalMensaje({ tipo: 'danger', texto: data.error || 'No se pudo solicitar aprobación.' });
        }
      })
      .catch(err => {
        console.error('Error solicitar aprobacion:', err);
        setModalMensaje({ tipo: 'danger', texto: 'Error de red al solicitar aprobación.' });
      });
  };


  // --- Acciones CRUD ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    setModalMensaje({ tipo: 'info', texto: 'Guardando...' });
    setIsSavingOrden(true);
    try {
  const saveResult = await saveOrden();
      // Determine created/updated order number
      const nro = saveResult?.nroDeOrden || saveResult?.nro || form?.nroDeOrden || 'nueva';
      const nuevoEstado = form?.estado || (modalModo === 'alta' ? 'En Diagnóstico' : 'Actualizada');
      
      // Refresh data
      fetchOrdenes();
      
      // Show result modal for feedback (solo uno)
      setResultModal({ open: true, success: true, title: modalModo === 'alta' ? 'Orden creada' : 'Orden actualizada', message: `Orden #${nro} guardada correctamente.` });
      
      // Cerrar el modal de edición inmediatamente
      handleModalClose();

      // If this was a newly created order, attempt to automatically send the comprobante
      if (modalModo === 'alta') {
        setModalMensaje({ tipo: 'info', texto: 'Orden guardada. Enviando comprobante automáticamente...' });
        try {
          // Try to fetch full order info to obtain client contact
          const orderResp = await fetch(`${API_URL}/${nro}`);
          let orderData = null;
          if (orderResp.ok) {
            orderData = await orderResp.json().catch(() => null);
          }

          // Prepare phone (whatsapp) if available
          let phone = null;
          try {
            phone = orderData && (orderData.cliente?.telefono || orderData.cliente?.telefonoCelular || orderData.cliente?.telefonoContacto || orderData.dispositivo?.cliente?.telefono) || null;
          } catch (e) { phone = null; }

          // Attempt WhatsApp send if phone available
          if (phone) {
            try {
              await fetch(`${API_URL}/${nro}/pdf/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ destinatario: String(phone).replace(/[^0-9]/g, '') })
              });
            } catch (waErr) {
              console.warn('Auto WhatsApp send failed:', waErr);
            }
          } else {
            // If no phone in order data, attempt send without destinatario (backend may fallback to client data)
            try {
              await fetch(`${API_URL}/${nro}/pdf/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
            } catch (waErr) {
              console.warn('Auto WhatsApp send without destinatario failed:', waErr);
            }
          }

          // Attempt email send (backend will use client email if none provided)
          try {
            await fetch(`${API_URL}/${nro}/pdf/send_email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
          } catch (emailErr) {
            console.warn('Auto Email send failed:', emailErr);
          }

          setModalMensaje({ tipo: 'success', texto: 'Comprobante: intento de envío automático completado (WhatsApp/Email). Si faltan datos, el envío puede no haberse realizado.' });
        } catch (sendErr) {
          console.error('Error en envío automático de comprobante:', sendErr);
          setModalMensaje({ tipo: 'warning', texto: 'Orden guardada, pero no se pudo enviar automáticamente el comprobante. Revisá la consola para más detalles.' });
        }
      }
    } catch (err) {
      console.error('[Ordenes.jsx] handleSubmit error:', err);
      // Mostrar el error en el modal (más visible)
      setModalMensaje({ tipo: 'danger', texto: err.message || 'Error al guardar la orden' });
      setResultModal({ open: true, success: false, title: 'Error', message: err.message || 'Error al guardar la orden' });
    } finally {
      setIsSavingOrden(false);
    }
  };

  // Helper para guardar la orden (separa la lógica para poder llamarla antes de confirmar)
  const saveOrden = async () => {
    // Validaciones previas
    const errors = validarOrden(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      console.warn('[Ordenes.jsx] saveOrden: validación fallida', errors);
      throw new Error('Validación fallida: ' + JSON.stringify(errors));
    }

    const preparedDetalles = detalles.map(d => {
      let finalRepuestoProveedorId = d.repuesto_proveedor_id;
      if (d.isNew || editingDetalleId === d.idDetalle || !finalRepuestoProveedorId) {
        // Be tolerant with field names returned by backend: relation may contain
        // 'id' (relation id), 'idRepuesto' or 'codigoRepuesto', and provider CUIL
        // may be under 'cuilProveedor' or 'cuil' or provider id under 'idProveedor'.
        let repuestoProveedorRel = repuestosProveedores.find(rp => {
          const rpIdRepuesto = rp.idRepuesto ?? rp.codigoRepuesto ?? rp.idRepuesto;
          const rpCuil = rp.cuilProveedor ?? rp.cuil ?? null;
          const rpIdProveedor = rp.idProveedor ?? rp.idProveedor ?? null;
          return String(rpIdRepuesto) === String(d.codRepuestos) && (String(rpCuil) === String(d.cuitProveedor) || String(rpIdProveedor) === String(d.cuitProveedor));
        });
        if (repuestoProveedorRel) {
          finalRepuestoProveedorId = repuestoProveedorRel.id;
        }
      }

      return {
        idDetalle: typeof d.idDetalle === 'string' && d.idDetalle.startsWith('new_') ? null : d.idDetalle,
        idServicio: d.codigoServicio || d.idServicio,
        repuesto_proveedor_id: finalRepuestoProveedorId ?? null,
        costoServicio: parseFloat(d.costoServicio || 0),
        costoRepuesto: parseFloat(d.costoRepuesto || 0),
        subtotal: parseFloat(d.subtotal || 0)
      };
    });

    const shouldSendDiagnostico = (modalModo !== 'alta') && (!isSalesAdmin) && (typeof form.diagnostico === 'string' ? form.diagnostico.trim().length > 0 : Boolean(form.diagnostico));

    const payload = {
      ...form,
      fecha: undefined,
      ...(shouldSendDiagnostico ? { diagnostico: form.diagnostico } : {}),
      presupuesto: parseFloat(form.presupuesto) || 0,
      ...(isSalesAdmin ? {} : { detalles: preparedDetalles })
    };

    const url = modalModo === 'alta' ? API_URL : `${API_URL}/${form.nroDeOrden}`;
    const method = modalModo === 'alta' ? 'POST' : 'PUT';
    const idSesionHeader = localStorage.getItem('idSesion');
    const headers = { 'Content-Type': 'application/json' };
    if (idSesionHeader) headers['X-Id-Sesion'] = idSesionHeader;

    // Ejecutar fetch y retornar respuesta JSON o lanzar error
    // Debug: log payload and target URL before sending
    try { console.log('[Ordenes.jsx] saveOrden -> URL:', url, 'method:', method, 'payload:', payload); } catch (e) {}

    const resp = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      let body = {};
      try { body = await resp.json(); } catch (e) { body = {}; }
      throw new Error(body?.error || body?.detail || `HTTP ${resp.status}`);
    }
    return resp.json().catch(() => ({}));
  };

  // Handler que guarda cambios y luego solicita aprobación (usado por el botón Confirmar)
  const handleConfirmarYGuardar = async () => {
    console.log('[Ordenes.jsx] handleConfirmarYGuardar clicked. detalles.length=', detalles ? detalles.length : 0, 'form.nroDeOrden=', form?.nroDeOrden);
    setIsConfirmingOrden(true);
    setModalMensaje({ tipo: 'info', texto: 'Guardando...' });
    try {
      await saveOrden();
      console.log('[Ordenes.jsx] saveOrden succeeded, now requesting approval for', form.nroDeOrden);
      // Después de guardar correctamente solicitamos aprobación
      handleSolicitarAprobacion(form.nroDeOrden);
      // Mostrar modal de resultado y cerrar modal de edición
      setResultModal({ open: true, success: true, title: 'Orden guardada', message: `Orden #${form.nroDeOrden} guardada y solicitada aprobación.` });
      // Cerrar modal (la notificación de cambio será manejada por handleSolicitarAprobacion)
      handleModalClose();
    } catch (err) {
      console.error('[Ordenes.jsx] handleConfirmarYGuardar error:', err);
      // Mostrar error en el modal para que el usuario lo vea claramente
      setModalMensaje({ tipo: 'danger', texto: err.message || 'Error al guardar antes de confirmar' });
      setResultModal({ open: true, success: false, title: 'Error al guardar', message: err.message || 'Error al guardar antes de confirmar' });
    } finally {
      setIsConfirmingOrden(false);
    }
  };


  const handleAgregarDetalleLocal = (e) => {
    e.preventDefault();
    if (isSalesAdmin) {
      setMensaje('No tenés permiso para agregar detalles.');
      return;
    }
    const errors = validarNuevoDetalle(nuevoDetalle);
    setNuevoDetalleErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    const [codRepuestosFromValue, cuitProveedorFromValue] = (nuevoDetalle.repuestoProveedor || "").split('/');
    const codRepuestos = nuevoDetalle.codigoRepuesto || codRepuestosFromValue || "";
    const cuitProveedor = cuitProveedorFromValue || "";

  const servicioObj = servicios.find(s => String(s.idServicio) === String(nuevoDetalle.codigoServicio));
  const repuestoObj = availableRepuestos.find(r => String(r.idRepuesto) === String(codRepuestos));
  // Match provider either by cuil or by idProveedor (frontend passes idProveedor in the select value)
  const proveedorObj = proveedoresFiltrados.find(p => String(p.cuilProveedor) === String(cuitProveedor) || String(p.idProveedor) === String(cuitProveedor));

    // --- CORRECCIÓN: Buscar el ID de la relación aquí (tolerante a nombres de campo)
    const repuestoProveedorRel = repuestosProveedores.find(rp => {
      const rpIdRepuesto = rp.idRepuesto ?? rp.codigoRepuesto ?? rp.idRepuesto;
      const rpCuil = rp.cuilProveedor ?? rp.cuil ?? null;
      const rpIdProveedor = rp.idProveedor ?? null;
      return String(rpIdRepuesto) === String(codRepuestos) && (String(rpCuil) === String(cuitProveedor) || String(rpIdProveedor) === String(cuitProveedor));
    });

    const detalleCompleto = {
      idDetalle: editingDetalleId || `new_${Date.now()}`,
      isNew: !editingDetalleId,
      codigoServicio: nuevoDetalle.codigoServicio,
      servicioDescripcion: servicioObj ? servicioObj.descripcion : "",
      codRepuestos: codRepuestos,
      repuestoDescripcion: repuestoObj ? `${repuestoObj.marca} ${repuestoObj.modelo}`.trim() : "",
      cuitProveedor: cuitProveedor,
      proveedorRazonSocial: proveedorObj ? proveedorObj.razonSocial : "",
      costoServicio: parseFloat(nuevoDetalle.costoServicio) || 0,
      costoRepuesto: parseFloat(nuevoDetalle.costoRepuesto) || 0,
      subtotal: parseFloat(nuevoDetalle.subtotal) || 0,
      repuesto_proveedor_id: repuestoProveedorRel ? repuestoProveedorRel.id : null // <-- Añadir el ID encontrado
    };

    if (editingDetalleId) {
      setDetalles(prev => prev.map(d => d.idDetalle === editingDetalleId ? detalleCompleto : d));
      setMensaje('Detalle actualizado localmente.');
    } else {
      setDetalles(prev => [...prev, detalleCompleto]);
      setMensaje('Detalle añadido localmente.');
    }

    setEditingDetalleId(null);
    setNuevoDetalle({ codigoServicio: "", codigoRepuesto: "", repuestoProveedor: "", costoServicio: "", costoRepuesto: "", subtotal: "" });
    setNuevoDetalleErrors({});
    setAvailableRepuestos([]);
    setProveedoresFiltrados([]);
  };


  const [confirmRemoveDetalle, setConfirmRemoveDetalle] = useState({ open: false, id: null });

  const handleRemoveDetalleLocal = (idDetalle) => {
    if (isSalesAdmin) {
      setMensaje('No tenés permiso para eliminar detalles.');
      return;
    }
    setConfirmRemoveDetalle({ open: true, id: idDetalle });
  };

  const confirmRemoveDetalleCancel = () => setConfirmRemoveDetalle({ open: false, id: null });

  const confirmRemoveDetalleConfirm = () => {
    const id = confirmRemoveDetalle.id;
    setDetalles(prev => prev.filter(d => d.idDetalle !== id));
    setMensaje('Detalle eliminado localmente.');
    setConfirmRemoveDetalle({ open: false, id: null });
  };

  const handleEditarDetalleClick = (detalle) => {
    if (isSalesAdmin) {
      setMensaje('No tenés permiso para editar detalles.');
      return;
    }
    console.log("Editando detalle:", detalle); // Para depuración
    setNuevoDetalle({
      codigoServicio: String(detalle.codigoServicio || ''),
      codigoRepuesto: String(detalle.codRepuestos || ''),
      repuestoProveedor: detalle.codRepuestos && detalle.cuitProveedor ? `${detalle.codRepuestos}/${detalle.cuitProveedor}` : '',
      costoServicio: String(detalle.costoServicio || ''),
      costoRepuesto: String(detalle.costoRepuesto || ''),
      subtotal: String(detalle.subtotal || '')
    });

    // Cargar availableRepuestos para el servicio seleccionado
    const servicioCodigo = detalle.codigoServicio;
    if (servicioCodigo) {
      fetch(`http://localhost:5000/servicios/${encodeURIComponent(servicioCodigo)}/repuestos`)
        .then(res => res.ok ? res.json() : Promise.reject(res))
        .then(data => {
          console.log("Repuestos cargados para edición:", data); // Depuración
          setAvailableRepuestos(Array.isArray(data) ? data : []);

          // Cargar proveedores para el repuesto seleccionado
          const cod = detalle.codRepuestos;
          const encontrado = (Array.isArray(data) ? data : []).find(r => String(r.idRepuesto) === String(cod));
          if (encontrado && Array.isArray(encontrado.proveedores)) {
            setProveedoresFiltrados(encontrado.proveedores);
          } else {
            // Fallback a repuestosProveedores (flat relations) -> construir lista de proveedores
            const relacionados = repuestosProveedores.filter(rp => String(rp.idRepuesto) === String(cod) || String(rp.codigoRepuesto) === String(cod) || String(rp.id) === String(cod));
            if (relacionados.length > 0) {
              const provs = relacionados.map(rp => ({
                idProveedor: rp.idProveedor ?? rp.idProveedor,
                cuilProveedor: rp.cuilProveedor ?? rp.cuil ?? null,
                razonSocial: rp.razonSocial ?? `Proveedor ${rp.idProveedor}`,
                costo: rp.costo ?? 0
              }));
              setProveedoresFiltrados(provs);
            } else {
              setProveedoresFiltrados([]);
            }
          }
        })
        .catch(err => {
          console.error("Error al cargar repuestos para edición:", err);
          setAvailableRepuestos([]);
          setProveedoresFiltrados([]);
        });
    } else {
      setAvailableRepuestos([]);
      setProveedoresFiltrados([]);
    }

    // abrir el formulario para editar este detalle
    setEditingDetalleId(detalle.idDetalle);
    setShowAddDetalle(true);
    setMensaje('Edite los campos y presione "Actualizar" para guardar.');
  };

  const handleOpenActualizarHistorial = (orden) => {
    setActualizarHistorialOrden(orden);
    setActualizarHistorialTexto('');
    setShowActualizarHistorialModal(true);
  };

  const handleEnviarHistorial = () => {
    if (!actualizarHistorialOrden) return;
    if (!actualizarHistorialTexto || !actualizarHistorialTexto.trim()) {
      setMensaje('Ingrese una descripción para el historial.');
      return;
    }
    const nro = actualizarHistorialOrden.nroDeOrden;
    setMensaje('Guardando historial...');
    setIsSavingHistorial(true);
    fetch(`${API_URL}/${nro}/actualizaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descripcion: actualizarHistorialTexto, usuario: identity?.nombre || 'web' })
    })
      .then(res => {
        if (!res.ok) return res.json().then(b => Promise.reject(new Error(b?.error || b || `HTTP ${res.status}`)));
        return res.json().catch(() => ({}));
      })
      .then(() => {
        setMensaje(`Historial guardado para orden #${nro}`);
        setShowActualizarHistorialModal(false);
        setActualizarHistorialOrden(null);
        setActualizarHistorialTexto('');
        // refrescar avances y lista de ordenes
        fetchOrdenes();
      })
      .catch(err => {
        console.error('Error guardando historial:', err);
        setMensaje(`No se pudo guardar el historial: ${err.message}`);
      })
      .finally(() => setIsSavingHistorial(false));
  };

  const handleNuevoClienteChange = (e) => {
    const { name, value } = e.target;
    setNuevoCliente(prev => ({ ...prev, [name]: value }));
    setNuevoClienteErrors(validarCliente({ ...nuevoCliente, [name]: value }));
  };

  const handleNuevoDispositivoChange = (e) => {
    const { name, value } = e.target;
    setNuevoDispositivo(prev => ({ ...prev, [name]: value }));
    setNuevoDispositivoErrors(validarDispositivo({ ...nuevoDispositivo, [name]: value }));
  };

  const handleGuardarCliente = () => {
    const errors = validarCliente(nuevoCliente);
    setNuevoClienteErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setIsSavingCliente(true);
    fetch(CLIENTES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevoCliente)
    })
      .then(res => res.json())
      .then(() => {
        fetchClientes();
        if (preservedFormData && redirectAfterAdd === 'cliente') {
          setForm(preservedFormData);
          setDetalles(preservedFormData.detalles || []);
          setPreservedFormData(null);
          setRedirectAfterAdd(null);
        }
        setNuevoCliente({ idTipoDoc: "", numeroDoc: "", nombre: "", apellido: "", telefono: "", mail: "", activo: 1 });
        setShowAddClienteModal(false);
        setNuevoClienteErrors({});
        setResultModal({ open: true, success: true, title: 'Cliente creado', message: 'Cliente creado correctamente.' });
      })
      .catch(err => { console.error("Error saving cliente:", err); setResultModal({ open: true, success: false, title: 'Error', message: err.message || 'No se pudo crear el cliente' }); })
      .finally(() => setIsSavingCliente(false));
  };

  const handleGuardarDispositivo = () => {
    const errors = validarDispositivo(nuevoDispositivo);
    setNuevoDispositivoErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    setIsSavingDispositivo(true);
    fetch(DISPOSITIVOS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nuevoDispositivo)
    })
      .then(res => res.json())
      .then(data => {
        fetchDispositivos();
        if (preservedFormData && redirectAfterAdd === 'dispositivo') {
          setForm({ ...preservedFormData, idDispositivo: data.idDispositivo });
          setDetalles(preservedFormData.detalles || []);
          setPreservedFormData(null);
          setRedirectAfterAdd(null);
        } else {
          setForm(prev => ({ ...prev, idDispositivo: data.idDispositivo })); // Seleccionar el nuevo
        }
        setNuevoDispositivo({ nroSerie: "", marca: "", modelo: "", idCliente: "", activo: 1 });
        setShowAddDispositivoModal(false);
        setNuevoDispositivoErrors({});
        setResultModal({ open: true, success: true, title: 'Dispositivo creado', message: 'Dispositivo creado correctamente.' });
      })
      .catch(err => { console.error("Error saving dispositivo:", err); setResultModal({ open: true, success: false, title: 'Error', message: err.message || 'No se pudo crear el dispositivo' }); })
      .finally(() => setIsSavingDispositivo(false));
  };

  // Al crear o modificar un detalle, debes enviar el campo repuesto_proveedor_id (no cuitProveedor/codigoRepuesto) al backend.
  // Para eso, busca el repuesto_proveedor_id antes de hacer el POST o PUT.
  async function _getRepuestoProveedorId(codRepuestos, cuitProveedor) {
    // Busca el objeto repuesto_proveedor en repuestosProveedores
    const rel = repuestosProveedores.find(
      r =>
        (String(r.idRepuesto) === String(codRepuestos) || String(r.codigoRepuesto) === String(codRepuestos)) &&
        (String(r.cuilProveedor) === String(cuitProveedor) || String(r.cuil) === String(cuitProveedor))
    );
    return rel ? rel.id : null;
  }

  // Flags to restrict what a technician can edit inside the modal
  const normalizedFormEstado = _normalize(form.estado || '');
  const isTechModifyingDiagnostico = isTecnico && modalModo === 'modificar' && normalizedFormEstado.includes('diagnost');
  const isTechModifyingReparacion = isTecnico && modalModo === 'modificar' && normalizedFormEstado.includes('reparacion');
  const technicianRestrictedMainFields = isTechModifyingDiagnostico || isTechModifyingReparacion;
  // Diagnóstico editable for técnicos únicamente cuando están diagnosticando, or when user has canModify
  const diagnosticoDisabled = modalModo === 'consultar' || (modalModo === 'modificar' && !(isTechModifyingDiagnostico || canModify));
  const modalTitle = modalModo === 'alta'
    ? 'Nueva Orden'
    : modalModo === 'modificar'
      ? (isTecnico ? (isTechModifyingDiagnostico ? 'Diagnosticar Orden' : (isTechModifyingReparacion ? 'Editar Detalles' : 'Modificar Orden')) : 'Modificar Orden')
      : 'Consultar Orden';

  return (
    <div className="container-fluid main-background" style={{ minHeight: '100vh' }}>
      <div className="row flex-nowrap">
        <MenuLateral />
        <main className="col-12 col-md-10 pt-4 px-2 px-md-4 d-flex flex-column">
          <div className="card shadow-sm mb-4" style={{ border: `1.5px solid #1f3345`, borderRadius: 16, background: "var(--color-beige)" }}>
            <div className="card-header d-flex justify-content-between align-items-center" style={{ background: '#1f3345', color: '#f0ede5', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <h4 className="mb-0"><i className="bi bi-clipboard-data me-2"></i>Gestión de Órdenes</h4>
              <div className="d-flex align-items-center gap-2">
                {isTecnico && (
                  <>
                    <button
                      type="button"
                      className={`btn header-filter-btn ${showOnlyEnReparacion ? 'btn-dorado' : 'btn-gris'}`}
                      onClick={() => setShowOnlyEnReparacion(v => !v)}
                      title="Filtrar órdenes en reparación"
                      style={{ marginRight: 8 }}
                    >
                      En Reparación
                    </button>

                    <button
                      type="button"
                      className={`btn header-filter-btn ${showOnlyEnDiagnostico ? 'btn-dorado' : 'btn-gris'}`}
                      onClick={() => setShowOnlyEnDiagnostico(v => !v)}
                      title="Filtrar órdenes en diagnóstico"
                    >
                      En Diagnostico
                    </button>
                  </>
                )}
                {isSalesAdmin && (
                  <button
                    type="button"
                    className={`btn header-filter-btn ${showOnlyPendienteAprobacion ? 'btn-dorado' : 'btn-gris'}`}
                    onClick={() => setShowOnlyPendienteAprobacion(v => !v)}
                    title="Filtrar órdenes pendientes de aprobación"
                  >
                    Pendiente Aprob.
                  </button>
                )}
                {isPurchaseAdmin && (
                  <button
                    type="button"
                    className={`btn header-filter-btn ${showOnlyPendienteRetiro ? 'btn-dorado' : 'btn-gris'}`}
                    onClick={() => setShowOnlyPendienteRetiro(v => !v)}
                    title="Filtrar órdenes pendientes de retiro"
                    style={{ marginRight: 8 }}
                  >
                    Pendiente Retiro
                  </button>
                )}
                {/* único botón Pendiente Retiro (visible para idCargo === 3 a través de isPurchaseAdmin) */}
                {isSalesAdmin && (
                  <button
                    type="button"
                    className={`btn header-filter-btn ${isMarkingAbandoned ? 'btn-dorado' : 'btn-gris'}`}
                    onClick={() => handleMarkAbandoned()}
                    title="Marcar órdenes como Abandonada (fechaInicioRetiro >= 30 días)"
                    style={{ marginRight: 8 }}
                    disabled={isMarkingAbandoned}
                  >
                    {isMarkingAbandoned ? 'Marcando...' : 'Marcar Abandonadas'}
                  </button>
                )}

                {canCreate && <button className="btn btn-verdeAgua" onClick={handleAgregarClick}><i className="bi bi-plus-lg"></i> Agregar Orden</button>}
              </div>
            </div>
            <div className="card-body">
              {/* Search input */}
              <div className="mb-3">
                <input type="text" className="form-control" placeholder="Buscar por Nro Orden o Cliente..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
              {/* alert global para mensajes de cambio de estado / errores */}
              {_mensaje && (
                <div className={`alert alert-info alert-dismissible fade show mx-3 mt-3 mb-0`} role="alert">
                  {_mensaje}
                  <button type="button" className="btn-close" onClick={() => setMensaje('')}></button>
                </div>
              )}
              <div className="table-responsive" style={{ overflow: 'visible' }}>
                <table className="table table-hover align-middle">
                  <thead>
                    {showOnlyEnReparacion ? (
                      <tr>
                        <th>N° Orden</th>
                        <th>Dispositivo</th>
                        <th>Técnico</th>
                        <th>Diagnóstico</th>
                        <th>Acciones</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>N° Orden</th>
                        <th>Dispositivo</th>
                        <th>Cliente</th>
                        <th>Empleado</th>
                        <th>Fecha</th>
                        <th>Estado</th>
                        <th>Diagnóstico</th>
                        <th>Acciones</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {ordenes
                      .filter(o => {
                        // If there's a search query, search by nroDeOrden or cliente (name only, without DNI)
                        if (searchQuery && String(searchQuery).trim().length > 0) {
                          const q = _normalizeForSearch(String(searchQuery).trim());
                          // search by nroDeOrden anywhere (contains)
                          if (String(o.nroDeOrden).toLowerCase().includes(q)) return true;

                          // Tokenize query and ensure all tokens appear in cliente_info (name part only)
                          const tokens = q.split(/\s+/).filter(Boolean);
                          const clienteRaw = o.cliente_info ? String(o.cliente_info).split('(')[0].trim() : '';
                          const clienteText = clienteRaw ? _normalizeForSearch(clienteRaw) : '';
                          const allTokensMatch = tokens.every(t => clienteText && clienteText.includes(t));
                          if (allTokensMatch) return true;

                          return false;
                        }

                        // If no filter toggles are active, show all
                        if (!showOnlyEnDiagnostico && !showOnlyEnReparacion && !showOnlyPendienteAprobacion && !showOnlyPendienteRetiro) return true;
                        const estado = _normalize(o.estado || '');
                        const matchesDiagnostico = showOnlyEnDiagnostico && estado.includes('diagnost');
                        const matchesReparacion = showOnlyEnReparacion && estado.includes('reparacion');
                        const matchesPendiente = showOnlyPendienteAprobacion && estado.includes('pendientedeaprobacion');
                        const matchesPendienteRetiro = showOnlyPendienteRetiro && (estado.includes('pendientederetiro') || estado.includes('retiro'));
                        return Boolean(matchesDiagnostico || matchesReparacion || matchesPendiente || matchesPendienteRetiro);
                      })
                      .map((o) => (
                        showOnlyEnReparacion ? (
                          <tr key={String(o.nroDeOrden)}>
                            <td>{o.nroDeOrden}</td>
                            <td>{o.dispositivo_info}</td>
                            <td>{o.empleado_info}</td>
                            <td>{o.diagnostico}</td>
                            <td>
                              <button className="btn btn-sm btn-verdeAgua fw-bold me-1" onClick={() => handleConsultar(o)}>
                                <i className="bi bi-search me-1"></i>Consultar
                              </button>
                              <button className="btn btn-sm btn-verdeAgua fw-bold me-1" onClick={() => handleOpenActualizarHistorial(o)}>
                                <i className="bi bi-arrow-clockwise me-1"></i>Actualizar historial
                              </button>
                              {isRetiroEstado(o.estado) && !isTecnico && (
                                <button className="btn btn-sm btn-rojo fw-bold me-1" onClick={() => handleGenerarComprobante(o.nroDeOrden)}>
                                  <i className="bi bi-file-earmark-pdf me-1"></i>Comprobante retiro
                                </button>
                              )}
                              {/* 'Terminar' button shown instead of 'Modificar' when viewing En Reparación filter. No functionality yet. */}
                              <button
                                className="btn btn-sm btn-dorado fw-bold"
                                onClick={() => { setTerminarOrden(o); setTerminarComentario(''); setTerminarSending(false); setTerminarModalOpen(true); }}
                                title="Terminar"
                              >
                                <i className="bi bi-flag-fill me-1"></i>Terminar
                              </button>
                              {/* Agregar botón Modificar también en la vista En Reparación */}
                              {!showOnlyPendienteAprobacion && (canModify || isSalesAdmin || (isTecnico && (_normalize(o.estado || '').includes('diagnost') || _normalize(o.estado || '').includes('reparacion')))) && (
                                  <button className="btn btn-sm btn-dorado fw-bold ms-2" onClick={() => handleModificar(o)}>
                                    <i className="bi bi-pencil-square me-1"></i>{isTecnico ? (_normalize(o.estado).includes('diagnost') ? 'Diagnosticar' : (_normalize(o.estado).includes('reparacion') ? 'Editar detalles' : 'Modificar')) : 'Modificar'}
                                  </button>
                              )}
                            </td>
                          </tr>
                        ) : showOnlyPendienteRetiro ? (
                          <tr key={String(o.nroDeOrden)}>
                            <td>{o.nroDeOrden}</td>
                            <td>{o.dispositivo_info}</td>
                            <td>{o.cliente_info ? o.cliente_info.split('(')[0].trim() : (o.dispositivo_info ? o.dispositivo_info.split('(')[0].trim() : '')}</td>
                            <td>{o.empleado_info}</td>
                            <td>{o.fecha}</td>
                            <td>{o.estado}</td>
                            <td>{o.diagnostico}</td>
                            <td>
                              <button className="btn btn-sm btn-verdeAgua fw-bold me-1" onClick={() => handleConsultar(o)}>
                                <i className="bi bi-search me-1"></i>Consultar
                              </button>
                              <button 
                                className="btn btn-sm btn-dorado fw-bold me-1" 
                                style={{ padding: '0.25rem .5rem', fontSize: '0.85rem' }} 
                                onClick={() => handleMarcarRetirada(o.nroDeOrden)}
                                disabled={markingRetiradaOrden === o.nroDeOrden}
                              >
                                {markingRetiradaOrden === o.nroDeOrden ? (
                                  <><i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>Procesando...</>
                                ) : (
                                  <><i className="bi bi-box-arrow-in-right me-1"></i>Marcar retirada</>
                                )}
                              </button>
                              {isSalesAdmin && !isTecnico && (
                                <button className="btn btn-sm btn-rojo fw-bold me-1" onClick={() => handleGenerarComprobante(o.nroDeOrden)}>
                                  <i className="bi bi-file-earmark-pdf me-1"></i>Emitir comprobante
                                </button>
                              )}
                            </td>
                          </tr>
                        ) : (
                          <tr key={String(o.nroDeOrden)}>
                            <td>{o.nroDeOrden}</td><td>{o.dispositivo_info}</td><td>{
                              // cliente_info has format 'Nombre Apellido (numeroDoc)'. We show only the name part.
                              o.cliente_info ? o.cliente_info.split('(')[0].trim() : (o.dispositivo_info ? o.dispositivo_info.split('(')[0].trim() : '')
                            }</td><td>{o.empleado_info}</td><td>{o.fecha}</td><td>{o.estado}</td><td>{o.diagnostico}</td><td>
                              {/* Mostrar botón calcular presupuesto SOLO cuando el filtro PendienteAprobación está activo */}
                              {showOnlyPendienteAprobacion && (
                                <button className="btn btn-sm btn-azul fw-bold me-1" onClick={() => handleAbrirCalcularPresupuesto(o)}>
                                  <i className="bi bi-calculator me-1"></i>Calcular Presupuesto
                                </button>
                              )}
                              <button className="btn btn-sm btn-verdeAgua fw-bold me-1" onClick={() => handleConsultar(o)}>
                                <i className="bi bi-search me-1"></i>Consultar
                              </button>
                              {/* 'Emitir' button removed as requested */}
                              {/* Ocultar el botón Modificar cuando se está filtrando por PendienteDeAprobacion */}
                              {!showOnlyPendienteAprobacion && (canModify || isSalesAdmin || (isTecnico && (_normalize(o.estado || '').includes('diagnost') || _normalize(o.estado || '').includes('reparacion')))) && (
                                  <button className="btn btn-sm btn-dorado fw-bold" onClick={() => handleModificar(o)}>
                                    <i className="bi bi-pencil-square me-1"></i>{isTecnico ? (_normalize(o.estado).includes('diagnost') ? 'Diagnosticar' : (_normalize(o.estado).includes('reparacion') ? 'Editar detalles' : 'Modificar')) : 'Modificar'}
                                  </button>
                              )}
                            </td></tr>
                        )
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modal para mostrar detalles y presupuesto calculado */}
      {presupuestoModalVisible && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1065 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Presupuesto - Orden #{presupuestoNroOrden}</h5>
                <button type="button" className="btn-close" onClick={() => setPresupuestoModalVisible(false)}></button>
              </div>
              <div className="modal-body">
                {presupuestoDetalles && presupuestoDetalles.length > 0 ? (
                  <div>
                    <table className="table table-striped">
                      <thead>
                        <tr>
                          <th>Servicio</th>
                          <th>Repuesto</th>
                          <th>Proveedor</th>
                          <th>Costo Servicio</th>
                          <th>Costo Repuesto</th>
                          <th>Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {presupuestoDetalles.map((d) => (
                          <tr key={d.idDetalle || JSON.stringify(d)}>
                            <td>{d.servicioDescripcion}</td>
                            <td>{d.repuestoDescripcion}</td>
                            <td>{d.proveedorRazonSocial || (d.proveedor && d.proveedor.razonSocial)}</td>
                            <td>${Number(d.costoServicio || 0).toFixed(2)}</td>
                            <td>${Number(d.costoRepuesto || 0).toFixed(2)}</td>
                            <td>${Number(d.subtotal || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-end fw-bold">Presupuesto final: ${Number(presupuestoCalc || 0).toFixed(2)}</div>
                  </div>
                ) : (
                  <div className="text-center text-muted">No se pudieron obtener los detalles de la orden.</div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-dorado" onClick={() => setPresupuestoModalVisible(false)}>Cerrar</button>
                {isSalesAdmin && (
                  <>
                    <button 
                      type="button" 
                      className="btn btn-success me-2" 
                      onClick={() => handlePresupuestoAceptar(presupuestoNroOrden)}
                      disabled={acceptingPresupuestoOrden === presupuestoNroOrden || rejectingPresupuestoOrden === presupuestoNroOrden}
                    >
                      {acceptingPresupuestoOrden === presupuestoNroOrden ? (
                        <><i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>Procesando...</>
                      ) : (
                        'Aceptar'
                      )}
                    </button>
                    <button 
                      type="button" 
                      className="btn btn-danger" 
                      onClick={() => handlePresupuestoRechazar(presupuestoNroOrden)}
                      disabled={acceptingPresupuestoOrden === presupuestoNroOrden || rejectingPresupuestoOrden === presupuestoNroOrden}
                    >
                      {rejectingPresupuestoOrden === presupuestoNroOrden ? (
                        <><i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>Procesando...</>
                      ) : (
                        'Rechazar'
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {modalVisible && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1040 }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <form onSubmit={handleSubmit}>

                <div className="modal-header">
                  <h5 className="modal-title">{modalTitle}</h5>
                  <button type="button" className="btn-close" onClick={handleModalClose}></button>
                </div>
                {modalMensaje && (
                  <div className={`alert alert-${modalMensaje.tipo} alert-dismissible fade show mx-3 mt-3 mb-0`}>
                    {modalMensaje.texto}
                    <button type="button" className="btn-close" onClick={() => setModalMensaje(null)}></button>
                  </div>
                )}

                <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: 16 }}>
                  <fieldset>
                    <legend>Datos de la Orden</legend>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label>Dispositivo</label>
                        <div className="d-flex">
                          <div className="flex-grow-1 me-2">
                            <SearchableSelect
                              options={dispositivos}
                              value={dispositivos.find(d => d.idDispositivo === form.idDispositivo) || ""}
                              onChange={(selected) => setForm(prev => ({ ...prev, idDispositivo: selected ? selected.idDispositivo : "" }))}
                              placeholder="Seleccione un dispositivo"
                              displayFormat={(d) => `${d.marca} ${d.modelo} (${d.nroSerie})`}
                                className={modalModo === 'consultar' || technicianRestrictedMainFields ? 'readonly-field' : ''}
                                disabled={modalModo === 'consultar' || technicianRestrictedMainFields}
                              required
                            />
                          </div>
                          {modalModo !== 'consultar' && !technicianRestrictedMainFields && (
                            <button type="button" className="btn btn-secondary" onClick={handleAddDispositivo}>
                              Nuevo Dispositivo
                            </button>
                          )}
                        </div>
                        {formErrors.idDispositivo && <div className="input-error-message">{formErrors.idDispositivo}</div>}
                      </div>
                      <div className="col-md-6">
                        <label>Técnico Asignado</label>
                        <SearchableSelect
                          options={empleados}
                          value={empleados.find(e => e.idEmpleado === form.idEmpleado) || ""}
                          onChange={(selected) => setForm(prev => ({ ...prev, idEmpleado: selected ? selected.idEmpleado : "" }))}
                          placeholder="Seleccione un Técnico"
                          displayFormat={(e) => `${e.nombre} ${e.apellido}`}
                          className={modalModo === 'consultar' || technicianRestrictedMainFields ? 'readonly-field' : ''}
                          disabled={modalModo === 'consultar' || technicianRestrictedMainFields}
                        />
                        {formErrors.idEmpleado && <div className="input-error-message">{formErrors.idEmpleado}</div>}
                      </div>
                      <div className="col-md-4">
                        <label>Fecha</label>
                        {/* En modo 'alta' la fecha la gestiona el servidor; en 'modificar' tampoco permitimos cambiar la fecha desde la UI */}
                        <input type="date" name="fecha" value={form.fecha} onChange={handleFormChange} className={`form-control ${modalModo === 'consultar' ? 'readonly-field' : ''}`} disabled={modalModo === 'consultar' || modalModo === 'alta' || modalModo === 'modificar'} readOnly={modalModo === 'alta' || modalModo === 'modificar'} />
                        {formErrors.fecha && <div className="input-error-message">{formErrors.fecha}</div>}
                        {modalModo === 'alta' && <div className="form-text text-muted">La fecha se asignará automáticamente al crear la orden.</div>}
                      </div>
                      <div className="col-md-4">
                        <label>Estado actual</label>
                        <input
                          type="text"
                          className="form-control"
                          value={modalModo === 'alta' ? 'En Diagnóstico' : form.estado || "-"}
                          readOnly
                          style={{ backgroundColor: "#e9ecef" }}
                        />
                      </div>
                      <div className="col-md-8">
                        <label>Descripción de Daños</label>
                        <input name="descripcionDanos" value={form.descripcionDanos} onChange={handleFormChange} className={`form-control ${modalModo === 'consultar' || technicianRestrictedMainFields ? 'readonly-field' : ''}`} disabled={modalModo === 'consultar' || technicianRestrictedMainFields} />
                        {formErrors.descripcionDanos && <div className="input-error-message">{formErrors.descripcionDanos}</div>}
                      </div>
                      {modalModo !== 'alta' && (
                        <div className="col-md-8">
                          <label>Diagnóstico</label>
                          <input
                            name="diagnostico"
                            value={form.diagnostico}
                            onChange={handleFormChange}
                            className={`form-control ${diagnosticoDisabled ? 'readonly-field' : ''}`}
                            disabled={diagnosticoDisabled}
                          />
                          {(modalModo === 'modificar' && isSalesAdmin && diagnosticoDisabled) && (
                            <div className="form-text text-muted">No tenés permiso para modificar el diagnóstico.</div>
                          )}
                        </div>
                      )}
                      <div className="col-md-4">
                        <label>Presupuesto Total</label>
                        {modalModo === 'consultar' ? (
                          <div className="input-group">
                            <span className="input-group-text">$</span>
                            <input type="text" className="form-control readonly-field" value={String(form.presupuesto ?? 0)} readOnly />
                          </div>
                        ) : (
                          <div className="input-group">
                            <span className="input-group-text">$</span>
                            <input type="number" name="presupuesto" value={form.presupuesto} onChange={handleFormChange} className="form-control" min="0" step="0.01" />
                          </div>
                        )}
                        {formErrors.presupuesto && <div className="input-error-message">{formErrors.presupuesto}</div>}
                      </div>
                    </div>

                    {/* Botones de confirmación de presupuesto (solo si está pendiente) */}
                    {/* En modo consulta ya no mostramos botones de aceptar/rechazar presupuesto (se maneja desde el modal de presupuesto) */}
                  </fieldset>

                  {/* Emitir comprobante UI fue removida */}

                  <fieldset className="mt-4">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <legend className="mb-0">Detalles de la Orden</legend>
                      {/* Solo permitir toggle de agregar detalle si no es Asistente de ventas */}
                      {modalModo !== 'consultar' && !isSalesAdmin && (
                        <button type="button" className="btn btn-verdeAgua btn-sm" onClick={() => setShowAddDetalle(v => !v)}>
                          {showAddDetalle ? 'Ocultar formulario' : 'Agregar detalle'}
                        </button>
                      )}
                    </div>
                    <table className="table table-striped">
                      <thead>
                        <tr>
                          <th>Servicio</th>
                          <th>Repuesto</th>
                          <th>Proveedor</th>
                          <th>Costo Servicio</th>
                          <th>Costo Repuesto</th>
                          <th>Subtotal</th>
                          {modalModo !== 'consultar' && <th>Acciones</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {detalles.map((detalle, index) => (
                          <tr key={String(detalle.idDetalle ?? index)}>
                            <td>{detalle.servicioDescripcion}</td>
                            <td>{detalle.repuestoDescripcion}</td>
                            <td>{detalle.proveedorRazonSocial}</td>
                            <td>${detalle.costoServicio}</td>
                            <td>${detalle.costoRepuesto}</td>
                            <td>${detalle.subtotal}</td>
                            {/* Ocultar acciones si es Asistente de ventas */}
                            {modalModo !== 'consultar' && !isSalesAdmin && (
                              <td>
                                {modalModo === 'modificar' && (
                                  <button type="button" className="btn btn-sm btn-dorado fw-bold me-2" onClick={(e) => { e.preventDefault(); handleEditarDetalleClick(detalle); }}>
                                    <i className="bi bi-pencil-square me-1"></i>Editar
                                  </button>
                                )}
                                <button type="button" className="btn btn-sm btn-danger fw-bold" onClick={(e) => { e.preventDefault(); handleRemoveDetalleLocal(detalle.idDetalle); }}>
                                  <i className="bi bi-trash me-1"></i>Eliminar
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detalles.length === 0 && <p className="text-muted">No hay detalles para esta orden.</p>}

                    {modalModo !== 'consultar' && showAddDetalle && !isSalesAdmin && (
                      <div className="row g-2 mt-2 align-items-end">
                        <div className="col">
                          <label>Servicio</label>
                          <select
                            name="codigoServicio"
                            value={nuevoDetalle.codigoServicio}
                            onChange={handleNuevoDetalleChange}
                            className="form-select"
                            disabled={modalModo === 'consultar'}
                          >
                            <option value="">Seleccione un servicio</option>
                            {servicios.map((s, index) => (
                              <option key={`${s.idServicio}-${index}`} value={s.idServicio}>
                                {s.descripcion}
                              </option>
                            ))}
                          </select>
                          {nuevoDetalleErrors.codigoServicio && <div className="input-error-message">{nuevoDetalleErrors.codigoServicio}</div>}
                        </div>
                        <div className="col">
                          <label>Repuesto</label>
                          <select
                            name="codigoRepuesto"
                            value={nuevoDetalle.codigoRepuesto}
                            onChange={handleNuevoDetalleChange}
                            className="form-select"
                            disabled={!nuevoDetalle.codigoServicio || modalModo === 'consultar'}
                          >
                            <option value="">Seleccione un repuesto</option>
                            {availableRepuestos.map((r, index) => (
                              <option
                                key={`${r.idRepuesto}-${index}`}
                                value={r.idRepuesto || r.codigoRepuesto || `${r.marca}-${r.modelo}-${index}`}
                                title={`${r.marca || ''} ${r.modelo || ''} ${r.descripcion ? '- ' + r.descripcion : ''}`}
                              >
                                {`${r.marca || ''} ${r.modelo || ''}`.trim()} {r.descripcion ? ` - ${r.descripcion}` : ''}
                              </option>
                            ))}
                          </select>
                          {nuevoDetalleErrors.codigoRepuesto && <div className="input-error-message">{nuevoDetalleErrors.codigoRepuesto}</div>}
                          {/* Hint when repuesto select is disabled because no servicio selected */}
                          {!nuevoDetalle.codigoServicio && modalModo !== 'consultar' ? (
                            <div className="form-text text-muted">Seleccione un servicio antes de elegir un repuesto.</div>
                          ) : null}
                        </div>

                        <div className="col">
                          <label>Proveedor</label>
                          <select
                            name="repuestoProveedor"
                            value={nuevoDetalle.repuestoProveedor}
                            onChange={handleNuevoDetalleChange}
                            className="form-select"
                            disabled={!nuevoDetalle.codigoRepuesto || modalModo === 'consultar'}
                          >
                            <option value="">Seleccione un proveedor</option>
                            {proveedoresFiltrados.map((p, index) => (
                              <option
                                key={`${p.idProveedor}-${index}`}
                                value={`${nuevoDetalle.codigoRepuesto}/${p.idProveedor}`}
                                title={`${p.razonSocial || ''}${p.cuilProveedor ? ' (CUIL: ' + p.cuilProveedor + ')' : ''} - $${p.costo || 0}`}
                              >
                                {`${p.razonSocial || ''}${p.cuilProveedor ? ' (' + p.cuilProveedor + ')' : ''} - $${p.costo || 0}`}
                              </option>
                            ))}
                          </select>
                          {nuevoDetalleErrors.repuestoProveedor && <div className="input-error-message">{nuevoDetalleErrors.repuestoProveedor}</div>}
                          {/* Hint when proveedor select is disabled because no repuesto selected */}
                          {!nuevoDetalle.codigoRepuesto && modalModo !== 'consultar' ? (
                            <div className="form-text text-muted">Seleccione un repuesto antes de elegir un proveedor.</div>
                          ) : null}
                        </div>
                        <div className="col">
                          <label>Costo Serv.</label>
                          <input name="costoServicio" value={nuevoDetalle.costoServicio ? `$${nuevoDetalle.costoServicio}` : ''} className="form-control" readOnly />
                          {nuevoDetalleErrors.costoServicio && <div className="input-error-message">{nuevoDetalleErrors.costoServicio}</div>}
                        </div>
                        <div className="col">
                          <label>Costo Rep.</label>
                          <input name="costoRepuesto" value={nuevoDetalle.costoRepuesto ? `$${nuevoDetalle.costoRepuesto}` : ''} className="form-control" readOnly />
                          {nuevoDetalleErrors.costoRepuesto && <div className="input-error-message">{nuevoDetalleErrors.costoRepuesto}</div>}
                        </div>
                        <div className="col">
                          <label>Subtotal</label>
                          <input name="subtotal" value={nuevoDetalle.subtotal ? `$${nuevoDetalle.subtotal}` : ''} className="form-control" readOnly />
                          {nuevoDetalleErrors.subtotal && <div className="input-error-message">{nuevoDetalleErrors.subtotal}</div>}
                        </div>
                        <div className="col-auto d-flex gap-2">
                          <button type="button" className="btn btn-verdeAgua" onClick={handleAgregarDetalleLocal}>
                            {editingDetalleId ? 'Actualizar' : 'Añadir'}
                          </button>
                          {editingDetalleId && (
                            <button type="button" className="btn btn-dorado" onClick={() => {
                              setEditingDetalleId(null);
                              setNuevoDetalle({
                                codigoServicio: "",
                                codigoRepuesto: "",
                                repuestoProveedor: "",
                                costoServicio: "",
                                costoRepuesto: "",
                                subtotal: ""
                              });
                              setNuevoDetalleErrors({}); // Limpiar errores al cancelar edición
                              setMensaje('Edición cancelada.');
                            }}>
                              Cancelar
                            </button>
                          )}
                        </div>
                        <ConfirmModal
                          open={confirmRemoveDetalle.open}
                          title="Confirmar eliminación"
                          message="¿Seguro que desea eliminar este detalle?"
                          onCancel={confirmRemoveDetalleCancel}
                          onConfirm={confirmRemoveDetalleConfirm}
                        />
                      </div>
                    )}
                  </fieldset>


                  {/* Sección de Avances Técnicos - SOLO visible cuando la orden está En Reparación */}
                  {form.estado === 'En Reparación' && (
                    <fieldset className="mt-4">
                      <legend>Avances Técnicos</legend>

                      {/* Formulario para agregar avances - visible SOLO para técnicos */}
                      {isTecnico && modalModo !== 'consultar' && (
                        <div className="mb-3">
                          <div className="input-group">
                            <input
                              type="text"
                              value={nuevoAvance}
                              onChange={e => setNuevoAvance(e.target.value)}
                              placeholder="Descripción del avance técnico"
                              className="form-control"
                            />
                            <button
                              type="button"
                              className="btn btn-dorado"
                              onClick={_registrarAvance}
                            >
                              <i className="bi bi-plus-circle me-1"></i> Registrar avance
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Historial de avances */}
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <h5 className="mb-0">Historial de avances</h5>
                        <button
                          type="button"
                          className="btn btn-sm btn-verdeAgua"
                          onClick={_cargarAvances}
                        >
                          <i className="bi bi-arrow-clockwise me-1"></i> Actualizar historial
                        </button>
                      </div>

                      {/* Lista de avances */}
                      {avances.length > 0 ? (
                        <div className="list-group">
                          {avances.map(a => (
                            <div key={a.idHistorialor} className="list-group-item list-group-item-action">
                              <div className="d-flex w-100 justify-content-between">
                                <h6 className="mb-1 fw-bold">Avance técnico</h6>
                                <small className="text-muted">
                                  {new Date(a.fechaArreglo).toLocaleString()}
                                </small>
                              </div>
                              <p className="mb-1">{a.descripcion}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="alert alert-light text-center">
                          No hay avances registrados para esta orden.
                          {isTecnico ? ' Utilice el formulario superior para registrar un nuevo avance.' : ''}
                        </div>
                      )}
                    </fieldset>
                  )}

                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-dorado" onClick={handleModalClose}>Cerrar</button>
                  {/* Botón para comprobante de retiro: sólo visible en modo 'consultar' si hay fechaInicioRetiro o estado PendienteDeRetiro/Retirada */}
                  {modalModo === 'consultar' && isRetiroEstado(form.estado) && !isTecnico && !isSalesAdmin && (
                    <button type="button" className="btn btn-sm btn-rojo fw-bold me-2" onClick={() => handleGenerarComprobante(form.nroDeOrden)}>
                      <i className="bi bi-file-earmark-pdf me-1"></i>Comprobante de retiro
                    </button>
                  )}
                  {modalModo === 'modificar' && isTecnico && (
                    <button
                      type="button"
                      className="btn btn-dorado me-2"
                      onClick={() => handleConfirmarYGuardar()}
                      disabled={isConfirmingOrden || !(detalles && detalles.length >= 1)}
                      title={!(detalles && detalles.length >= 1) ? 'Debe agregar al menos 1 detalle antes de confirmar' : ''}
                    >
                      {isConfirmingOrden ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Guardando...
                        </>
                      ) : 'Confirmar'}
                    </button>
                  )}
                  {modalModo !== 'consultar' && (
                    <button
                      type="submit"
                      className="btn btn-azul"
                      disabled={isSavingOrden}
                    >
                      {isSavingOrden ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Guardando...
                        </>
                      ) : 'Guardar'}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal global para mensajes (_mensaje) usando ConfirmModal */}
      <ConfirmModal
        open={!!modalMensajeGlobal}
        title={modalMensajeGlobal ? (modalMensajeGlobal.tipo === 'danger' ? 'Error' : modalMensajeGlobal.tipo === 'warning' ? 'Atención' : 'Mensaje') : 'Mensaje'}
        message={
          modalMensajeGlobal ? (
            <div>
              <p style={{ marginBottom: 12 }}>{modalMensajeGlobal.texto}</p>
              {Array.isArray(modalMensajeGlobal.markedOrders) && modalMensajeGlobal.markedOrders.length > 0 ? (
                <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Nro</th>
                        <th>Cliente</th>
                        <th>Dispositivo</th>
                        <th>Fecha Inicio Retiro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modalMensajeGlobal.markedOrders.map((o, idx) => (
                        <tr key={o.nroDeOrden || idx}>
                          <td>{o.nroDeOrden ?? o.nroDeOrden}</td>
                          <td>{(o.cliente_info && String(o.cliente_info).split('(')[0].trim()) || (o.cliente && ((o.cliente.nombre || '') + ' ' + (o.cliente.apellido || '')).trim()) || '-'}</td>
                          <td>{o.dispositivo_info || (o.dispositivo && (o.dispositivo.marca || '') + ' ' + (o.dispositivo.modelo || '')) || '-'}</td>
                          <td>{o.fechaInicioRetiro ? (String(o.fechaInicioRetiro).split('T')[0]) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : ''
        }
        onCancel={() => { setModalMensajeGlobal(null); setMensaje(''); }}
      />

      {/* Confirmación para marcar órdenes Abandonadas */}
      <ConfirmModal
        open={showMarkAbandonedModal}
        title="Confirmar marcado como Abandonada"
        message="¿Deseás marcar como ABANDONADA todas las órdenes cuya fecha de inicio de retiro tenga 30 días o más? Esta acción registrará un cambio de estado en el historial de cada orden."
        onCancel={() => setShowMarkAbandonedModal(false)}
        onConfirm={confirmMarkAbandoned}
      />

      {showAddClienteModal && (
        <div className="modal" style={{ display: "block", backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1060 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header" style={{ backgroundColor: '#1f3345', color: '#f0ede5' }}>
                <h5 className="modal-title fw-bold"><i className="bi bi-person-plus-fill me-2"></i>Nuevo Cliente</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowAddClienteModal(false)}></button>
              </div>
              <div className="modal-body">
                <form onSubmit={(e) => { e.preventDefault(); handleGuardarCliente(); }}>
                  <fieldset>
                    <legend className="d-none">Datos del cliente</legend>
                    <h6 className="fw-bold mt-3 mb-2 border-bottom pb-1"><i className="bi bi-person-lines-fill me-2"></i>Datos personales</h6>
                    <div className="row g-3">
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label><i className="bi bi-card-list me-2"></i>Tipo de documento</label>
                          <select name="idTipoDoc" value={nuevoCliente.idTipoDoc} onChange={handleNuevoClienteChange} className="form-control" required>
                            <option value="">Seleccione tipo de documento</option>
                            {tiposDoc.map(td => <option key={td.idTipoDoc} value={td.idTipoDoc}>{td.nombre}</option>)}
                          </select>
                          {nuevoClienteErrors.idTipoDoc && <div className="input-error-message">{nuevoClienteErrors.idTipoDoc}</div>}
                        </div>
                        <div className="mb-3">
                          <label><i className="bi bi-hash me-2"></i>Número de documento</label>
                          <input type="text" name="numeroDoc" value={nuevoCliente.numeroDoc} onChange={handleNuevoClienteChange} required className="form-control" />
                          {nuevoClienteErrors.numeroDoc && <div className="input-error-message">{nuevoClienteErrors.numeroDoc}</div>}
                        </div>
                      </div>
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label><i className="bi bi-person me-2"></i>Nombre</label>
                          <input type="text" name="nombre" value={nuevoCliente.nombre} onChange={handleNuevoClienteChange} required className="form-control" />
                          {nuevoClienteErrors.nombre && <div className="input-error-message">{nuevoClienteErrors.nombre}</div>}
                        </div>
                        <div className="mb-3">
                          <label><i className="bi bi-person me-2"></i>Apellido</label>
                          <input type="text" name="apellido" value={nuevoCliente.apellido} onChange={handleNuevoClienteChange} required className="form-control" />
                          {nuevoClienteErrors.apellido && <div className="input-error-message">{nuevoClienteErrors.apellido}</div>}
                        </div>
                      </div>
                    </div>
                    <h6 className="fw-bold mt-4 mb-2 border-bottom pb-1"><i className="bi bi-telephone me-2"></i>Datos de contacto</h6>
                    <div className="row g-3">
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label><i className="bi bi-telephone me-2"></i>Teléfono</label>
                          <input type="text" name="telefono" value={nuevoCliente.telefono} onChange={handleNuevoClienteChange} required className="form-control" />
                          {nuevoClienteErrors.telefono && <div className="input-error-message">{nuevoClienteErrors.telefono}</div>}
                        </div>
                      </div>
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label><i className="bi bi-envelope me-2"></i>Email</label>
                          <input type="email" name="mail" value={nuevoCliente.mail} onChange={handleNuevoClienteChange} required className="form-control" />
                          {nuevoClienteErrors.mail && <div className="input-error-message">{nuevoClienteErrors.mail}</div>}
                        </div>
                      </div>
                    </div>
                  </fieldset>
                  <div className="modal-footer mt-3">
                    <button type="button" className="btn btn-dorado fw-bold" onClick={() => setShowAddClienteModal(false)}><i className="bi bi-x-circle me-1"></i>Cancelar</button>
                    <button type="submit" className="btn btn-azul fw-bold" disabled={isSavingCliente}>
                      {isSavingCliente ? (
                        <>
                          <i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>
                          Guardando...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-save me-1"></i>
                          Guardar Cliente
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddDispositivoModal && (
        <div className="modal" style={{ display: "block", backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1050 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header" style={{ backgroundColor: '#1f3345', color: '#f0ede5' }}>
                <h5 className="modal-title fw-bold"><i className="bi bi-cpu me-2"></i>Agregar Nuevo Dispositivo</h5>
                <button type="button" className="btn-close btn-close-white" onClick={() => setShowAddDispositivoModal(false)}></button>
              </div>
              <div className="modal-body">
                <form onSubmit={(e) => { e.preventDefault(); handleGuardarDispositivo(); }}>
                  <fieldset>
                    <legend className="d-none">Datos del dispositivo</legend>
                    <div className="row g-3">
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label className="fw-semibold"><i className="bi bi-hash me-2"></i>Nro Serie</label>
                          <input className="form-control" name="nroSerie" value={nuevoDispositivo.nroSerie} onChange={handleNuevoDispositivoChange} required />
                          {nuevoDispositivoErrors.nroSerie && <div className="input-error-message">{nuevoDispositivoErrors.nroSerie}</div>}
                        </div>
                        <div className="mb-3">
                          <label className="fw-semibold"><i className="bi bi-pc me-2"></i>Marca</label>
                          <input className="form-control" name="marca" value={nuevoDispositivo.marca} onChange={handleNuevoDispositivoChange} required />
                          {nuevoDispositivoErrors.marca && <div className="input-error-message">{nuevoDispositivoErrors.marca}</div>}
                        </div>
                        <div className="mb-3">
                          <label className="fw-semibold"><i className="bi bi-pc-display me-2"></i>Modelo</label>
                          <input className="form-control" name="modelo" value={nuevoDispositivo.modelo} onChange={handleNuevoDispositivoChange} required />
                          {nuevoDispositivoErrors.modelo && <div className="input-error-message">{nuevoDispositivoErrors.modelo}</div>}
                        </div>
                      </div>
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label className="fw-semibold"><i className="bi bi-person-lines-fill me-2"></i>Cliente</label>
                          <div className="d-flex">
                            <div className="flex-grow-1 me-2">
                              <SearchableSelect
                                options={clientes}
                                value={clientes.find(c => c.idCliente === nuevoDispositivo.idCliente) || ""}
                                onChange={(selected) => setNuevoDispositivo(prev => ({ ...prev, idCliente: selected ? selected.idCliente : "" }))}
                                placeholder="Seleccione un cliente..."
                                displayFormat={(c) => `${tiposDoc.find(td => td.idTipoDoc === c.idTipoDoc)?.nombre || c.idTipoDoc} - ${c.numeroDoc} (${c.nombre} ${c.apellido})`}
                              />
                            </div>
                            <button type="button" className="btn btn-verdeAgua" onClick={handleAddCliente}><i className="bi bi-plus-lg"></i></button>
                          </div>
                          {nuevoDispositivoErrors.idCliente && <div className="input-error-message">{nuevoDispositivoErrors.idCliente}</div>}
                        </div>
                      </div>
                    </div>
                  </fieldset>
                  <div className="modal-footer mt-3">
                    <button type="button" className="btn btn-dorado fw-bold" onClick={() => setShowAddDispositivoModal(false)}><i className="bi bi-x-circle me-1"></i>Cancelar</button>
                    <button type="submit" className="btn btn-azul fw-bold" disabled={isSavingDispositivo}>
                      {isSavingDispositivo ? (
                        <>
                          <i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>
                          Guardando...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-save me-1"></i>
                          Guardar Dispositivo
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Terminar modal: aparece al presionar Terminar en la tabla 'En Reparación' */}
      {terminarModalOpen && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1065 }}>
          <div className="modal-dialog modal-md modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Terminar Orden #{terminarOrden?.nroDeOrden}</h5>
                <button type="button" className="btn-close" onClick={() => setTerminarModalOpen(false)}></button>
              </div>
              <div className="modal-body">
                <p className="mb-3">Marque el resultado de la reparación y agregue información adicional (opcional):</p>
                <div className="d-flex gap-2 mb-3">
                  <button type="button" className="btn btn-success flex-grow-1" disabled={terminarReparadaSending || terminarNoReparadaSending} onClick={async () => {
                    // Marcar orden como reparada: 1) actualizar resultado/informacionAdicional, 2) cambiar estado a PendienteDeRetiro
                    // Evitar múltiples envíos
                    if (terminarReparadaSending) return;
                    if (!terminarOrden) return;
                    setTerminarReparadaSending(true);
                    const nro = terminarOrden.nroDeOrden;
                    try {
                      // 1) PUT para actualizar resultado e informacionAdicional
                      const payload = {
                        resultado: 'reparada',
                        informacionAdicional: terminarComentario || null
                      };
                      const resPut = await fetch(`${API_URL}/${nro}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                      if (!resPut.ok) {
                        const body = await resPut.text().catch(() => '');
                        throw new Error(`Error actualizando orden: ${resPut.status} ${body}`);
                      }

                      // 2) POST para establecer estado PendienteDeRetiro
                      const resState = await fetch(`${API_URL}/${nro}/presupuesto/rechazar`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                      });
                      if (!resState.ok) {
                        const body = await resState.text().catch(() => '');
                        throw new Error(`Error cambiando estado: ${resState.status} ${body}`);
                      }

                      // Éxito: cerrar modal, refrescar lista y mostrar mensaje
                      setTerminarModalOpen(false);
                      notifyEstadoCambio(nro, 'PendienteDeRetiro', null, { refresh: true });
                    } catch (err) {
                      console.error('Error al terminar orden:', err);
                      // Mantener el modal abierto para que el usuario pueda reintentar o editar el comentario
                      setModalMensaje({ tipo: 'danger', texto: `No se pudo marcar la orden como reparada: ${err.message}` });
                    } finally {
                      setTerminarReparadaSending(false);
                    }
                  }}>
                    {terminarReparadaSending && <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>}
                    Reparada
                  </button>
                  <button type="button" className="btn btn-danger flex-grow-1" disabled={terminarReparadaSending || terminarNoReparadaSending} onClick={async () => {
                    if (terminarNoReparadaSending) return;
                    if (!terminarOrden) return;
                    setTerminarNoReparadaSending(true);
                    const nro = terminarOrden.nroDeOrden;
                    try {
                      const payload = {
                        resultado: 'no reparada',
                        informacionAdicional: terminarComentario || null
                      };
                      const resPut = await fetch(`${API_URL}/${nro}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                      if (!resPut.ok) {
                        const body = await resPut.text().catch(() => '');
                        throw new Error(`Error actualizando orden: ${resPut.status} ${body}`);
                      }

                      // Cambiar estado a PendienteDeRetiro
                      const resState = await fetch(`${API_URL}/${nro}/presupuesto/rechazar`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                      });
                      if (!resState.ok) {
                        const body = await resState.text().catch(() => '');
                        throw new Error(`Error cambiando estado: ${resState.status} ${body}`);
                      }

                      setTerminarModalOpen(false);
                      notifyEstadoCambio(nro, 'PendienteDeRetiro', null, { refresh: true });
                    } catch (err) {
                      console.error('Error al marcar no reparada:', err);
                      setModalMensaje({ tipo: 'danger', texto: `No se pudo marcar la orden como no reparada: ${err.message}` });
                    } finally {
                      setTerminarNoReparadaSending(false);
                    }
                  }}>
                    {terminarNoReparadaSending && <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>}
                    No reparada
                  </button>
                </div>

                <div>
                  <label className="form-label">Información adicional</label>
                  <textarea className="form-control" rows={4} value={terminarComentario} onChange={(e) => setTerminarComentario(e.target.value)} placeholder="Agregue notas, observaciones, o detalles del cierre..."></textarea>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-dorado" onClick={() => setTerminarModalOpen(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal para Actualizar Historial (invocado desde la tabla En Reparación) */}
      {showActualizarHistorialModal && actualizarHistorialOrden && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1066 }}>
          <div className="modal-dialog modal-md modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Actualizar historial - Orden #{actualizarHistorialOrden.nroDeOrden}</h5>
                <button type="button" className="btn-close" onClick={() => setShowActualizarHistorialModal(false)}></button>
              </div>
              <div className="modal-body">
                <div className="mb-2"><strong>Orden:</strong> #{actualizarHistorialOrden.nroDeOrden}</div>
                <div className="mb-2"><strong>Dispositivo:</strong> {actualizarHistorialOrden.dispositivo_info || '-'}</div>
                <div className="mb-2"><strong>Fecha:</strong> {new Date().toISOString().split('T')[0]}</div>
                <div className="mb-3">
                  <label className="form-label">Descripción / Nota</label>
                  <textarea className="form-control" rows={5} value={actualizarHistorialTexto} onChange={(e) => setActualizarHistorialTexto(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-dorado" onClick={() => setShowActualizarHistorialModal(false)}>Cancelar</button>
                <button type="button" className="btn btn-azul" onClick={handleEnviarHistorial} disabled={isSavingHistorial}>
                  {isSavingHistorial ? (
                    <>
                      <i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>
                      Guardando...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-save me-1"></i>
                      Guardar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Result modal for showing success/error feedback after actions */}
      <ResultModal
        open={resultModal.open}
        success={resultModal.success}
        title={resultModal.title}
        message={resultModal.message}
        onClose={() => setResultModal(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
}

export default Ordenes;