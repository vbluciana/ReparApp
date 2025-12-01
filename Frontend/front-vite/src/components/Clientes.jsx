import React, { useEffect, useState } from "react";
import ReactDOM from 'react-dom';
import MenuLateral from './MenuLateral';
import ConfirmModal from './ConfirmModal';
import ResultModal from './ResultModal';
import { usePermission } from '../auth/PermissionContext';
import { hasPermission } from '../utils/permissions';

const API_URL = "http://localhost:5000/clientes";
const TIPOS_DOC_URL = "http://localhost:5000/tipos-documento";

export default function Clientes() {
  const [clientes, setClientes] = useState([]);
  const [tiposDocumento, setTiposDocumento] = useState([]);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [form, setForm] = useState({ idTipoDoc: "", numeroDoc: "", nombre: "", apellido: "", telefono: "", mail: "", activo: 1 });
  const [formErrors, setFormErrors] = useState({});
  const [modalVisible, setModalVisible] = useState(false);
  const [modalModo, setModalModo] = useState('consultar'); // 'consultar' | 'modificar' | 'alta'
  const [clienteActual, setClienteActual] = useState(null);
  const [historialVisible, setHistorialVisible] = useState(false);
  const [historialOrdenes, setHistorialOrdenes] = useState([]);
  const [openMenuFor, setOpenMenuFor] = useState(null);
  const menuAnchorRefs = React.useRef({});
  const [editId, setEditId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dupChecking, setDupChecking] = useState(false);
  const [duplicateExists, setDuplicateExists] = useState(false);
  const [duplicateMsg, setDuplicateMsg] = useState("");
  const checkTimer = React.useRef(null);
  const [isSaving, setIsSaving] = useState(false);

  // Permission context and action flags
  const permCtx = usePermission();
  const identity = permCtx ? permCtx.identity : null;
  const canCreate = hasPermission(identity, 30);
  const canModify = hasPermission(identity, 31);
  const canView = hasPermission(identity, 32);
  const canDelete = hasPermission(identity, 33);

  const fetchClientes = async () => {
    try {
      const params = new URLSearchParams({ activos: (!mostrarInactivos).toString(), ...(searchTerm ? { search: searchTerm } : {}) });
      const res = await fetch(`${API_URL}?${params}`);
      if (!res.ok) throw new Error('network');
      const data = await res.json();
      setClientes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn(err);
      setMensaje('Error al cargar clientes');
    }
  };

  const fetchTiposDocumento = async () => {
    try {
      const res = await fetch(TIPOS_DOC_URL);
      if (!res.ok) throw new Error('network');
      const data = await res.json();
      setTiposDocumento(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn(err);
      setMensaje('Error al cargar tipos de documento');
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchClientes(); fetchTiposDocumento(); }, [mostrarInactivos, searchTerm]);

  // close dropdown / escape handlers
  useEffect(() => {
    const onDocClick = () => setOpenMenuFor(null);
    const onEsc = (e) => { if (e.key === 'Escape') setOpenMenuFor(null); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onEsc); };
  }, []);

  const validarDocumento = (tipo, numero) => {
    if (tipo === 'DNI') return /^\d{7,8}$/.test(numero);
    if (tipo === 'CUIT' || tipo === 'CUIL') return /^\d{11}$/.test(numero);
    if (tipo === 'PASAPORTE') return /^[A-Z0-9]{6,9}$/.test(numero);
    return true;
  };

  const validarCliente = f => {
    const errors = {};
    if (!f.idTipoDoc) errors.idTipoDoc = 'Debe seleccionar el tipo de documento.';
    if (!f.numeroDoc || !validarDocumento(f.idTipoDoc, f.numeroDoc)) errors.numeroDoc = 'Número de documento inválido para el tipo seleccionado.';
    if (!f.nombre || f.nombre.trim().length < 2) errors.nombre = 'El nombre es obligatorio y debe tener al menos 2 caracteres.';
    if (!f.apellido || f.apellido.trim().length < 2) errors.apellido = 'El apellido es obligatorio y debe tener al menos 2 caracteres.';
    if (!f.telefono || f.telefono.trim().length < 6) errors.telefono = 'El teléfono es obligatorio y debe tener al menos 6 dígitos.';
    if (!f.mail || !/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(f.mail)) errors.mail = 'El email no es válido.';
    return errors;
  };

  // debounce duplicate check
  const verificarDuplicado = (idTipoDoc, numeroDoc) => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(async () => {
      setDupChecking(true); setDuplicateExists(false); setDuplicateMsg('');
      try {
        const res = await fetch(`${API_URL}/existe?idTipoDoc=${encodeURIComponent(idTipoDoc)}&numeroDoc=${encodeURIComponent(numeroDoc)}`);
        if (!res.ok) { setDupChecking(false); return; }
        const j = await res.json();
        if (j.exists) { setDuplicateExists(true); setDuplicateMsg('Ya existe un cliente con ese tipo y número de documento.'); }
        else { setDuplicateExists(false); setDuplicateMsg(''); }
      } catch (e) {
        console.warn('verificarDuplicado error', e);
      } finally { setDupChecking(false); }
    }, 450);
  };

  const handleChange = e => {
    const { name, value } = e.target;
    const updated = { ...form, [name]: value };
    setForm(updated);
    setFormErrors(validarCliente(updated));
    if (name === 'idTipoDoc' || name === 'numeroDoc') {
      setDuplicateExists(false); setDuplicateMsg('');
      if (updated.idTipoDoc && updated.numeroDoc) verificarDuplicado(updated.idTipoDoc, updated.numeroDoc);
    }
  };

  useEffect(() => () => { if (checkTimer.current) clearTimeout(checkTimer.current); }, []);

  const handleAgregarClick = () => {
    if (!canCreate) { setMensaje('No tenés permiso para crear clientes.'); return; }
    setClienteActual(null); setModalModo('alta'); setModalVisible(true); setMensaje(''); setForm({ idTipoDoc: '', numeroDoc: '', nombre: '', apellido: '', telefono: '', mail: '', activo: 1 });
  };

  const handleModificar = (cliente) => {
    setEditId(cliente.idCliente);
    setClienteActual({ ...cliente });
    if (!canModify) { setModalModo('consultar'); setModalVisible(true); setMensaje('No tenés permiso para modificar clientes. Abriendo en modo consulta.'); return; }
    setForm({ idTipoDoc: cliente.idTipoDoc || '', numeroDoc: cliente.numeroDoc || '', nombre: cliente.nombre || '', apellido: cliente.apellido || '', telefono: cliente.telefono || '', mail: cliente.mail || '', activo: cliente.activo ?? 1 });
    setModalModo('modificar'); setModalVisible(true); setMensaje('');
  };

  const handleConsultar = (cliente) => {
    if (!canView) { setMensaje('No tenés permiso para ver clientes.'); return; }
    setClienteActual({ ...cliente }); setModalModo('consultar'); setModalVisible(true); setMensaje('');
  };

  const handleSubmit = async e => {
    e.preventDefault();
    if (!canCreate) { setMensaje('No tenés permiso para crear clientes.'); return; }
    const errors = validarCliente(form); setFormErrors(errors); if (Object.keys(errors).length) { setMensaje('Por favor, corrige los errores.'); return; }
    setIsSaving(true);
    try {
      const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json().catch(() => ({}));
      const resultMessage = j.error || j.mensaje || (j.detail ? `${j.error || 'Error'}: ${j.detail}` : '');
      setMensaje(resultMessage);
      setResultModal({ open: true, success: res.ok, title: res.ok ? 'Cliente creado' : 'Error', message: resultMessage || (res.ok ? 'Cliente creado correctamente.' : 'Ocurrió un error') });
      if (res.ok) { setModalVisible(false); fetchClientes(); }
    } catch (err) { console.error('Error al crear cliente:', err); setMensaje('Error de conexión'); setResultModal({ open: true, success: false, title: 'Error', message: 'Error de conexión al crear cliente' }); }
    finally { setIsSaving(false); }
  };

  const handleUpdate = async e => {
    e.preventDefault(); if (!canModify) { setMensaje('No tenés permiso para modificar clientes.'); return; }
    const errors = validarCliente(form); setFormErrors(errors); if (Object.keys(errors).length) { setMensaje('Por favor, corrige los errores.'); return; }
    setIsSaving(true);
    try {
      const res = await fetch(`${API_URL}/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json().catch(() => ({}));
      if (res.ok) { setModalVisible(false); setEditId(null); fetchClientes(); } else { setMensaje(j.error || j.mensaje || 'Error desconocido'); }
      setResultModal({ open: true, success: res.ok, title: res.ok ? 'Cliente actualizado' : 'Error', message: j.mensaje || j.error || (res.ok ? 'Cliente actualizado correctamente.' : 'Error al actualizar cliente.') });
    } catch (err) { console.warn(err); setMensaje('Error de conexión'); }
    finally { setIsSaving(false); }
  };

  const handleEliminar = (idCliente) => setConfirmDeleteCliente({ open: true, id: idCliente });

  const [confirmDeleteCliente, setConfirmDeleteCliente] = useState({ open: false, id: null });

  const confirmDeleteClienteCancel = () => setConfirmDeleteCliente({ open: false, id: null });

  const [bloqueoModal, setBloqueoModal] = useState({ open: false, message: '' });
  const [resultModal, setResultModal] = useState({ open: false, success: true, title: '', message: '' });

  const confirmDeleteClienteConfirm = async () => {
    const id = confirmDeleteCliente.id;
    if (!canDelete) { setMensaje('No tenés permiso para eliminar clientes.'); setConfirmDeleteCliente({ open: false, id: null }); return; }
    try {
      const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
      const resultado = await res.json().catch(() => ({}));
      if (res.ok) {
        setMensaje('Cliente eliminado');
        fetchClientes();
        setResultModal({ open: true, success: true, title: 'Cliente eliminado', message: 'El cliente fue eliminado correctamente.' });
      } else if (res.status === 400 && resultado.error) {
        setBloqueoModal({ open: true, message: resultado.error });
      } else {
        setMensaje(resultado.error || resultado.detail || resultado.mensaje || 'Error al eliminar cliente: No se pueden eliminar clientes asociados a órdenes activas.');
        setResultModal({ open: true, success: false, title: 'Error', message: resultado.error || resultado.detail || resultado.mensaje || 'Error al eliminar cliente: No se pueden eliminar clientes asociados a órdenes activas.' });
      }
    } catch (err) {
      console.warn(err); setMensaje('Error de conexión');
        setResultModal({ open: true, success: false, title: 'Error', message: 'Error de conexión al eliminar cliente.' });
    } finally {
      setConfirmDeleteCliente({ open: false, id: null });
    }
  };

  const handleReactivar = async (idCliente) => { try { const res = await fetch(`${API_URL}/${idCliente}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activo: 1 }) }); if (res.ok) { setMensaje('Cliente reactivado exitosamente'); fetchClientes(); } else setMensaje('Error al reactivar cliente'); } catch (err) { console.warn(err); setMensaje('Error de conexión'); } };

  return (
    <div className="container-fluid main-background" style={{ minHeight: '100vh' }}>
      <div className="row flex-nowrap">
        <MenuLateral />
        <main className="col-12 col-md-10 pt-4 px-2 px-md-4 d-flex flex-column" style={{ background: 'white', borderRadius: 16, boxShadow: `0 4px 24px 0 #1f334522`, minHeight: '90vh' }}>
          <div className="card shadow-sm mb-4" style={{ border: `1.5px solid #1f3345`, borderRadius: 16, background: "var(--color-beige)" }}>
            <div className="card-header d-flex justify-content-between align-items-center" style={{ background: "#1f3345", color: "#f0ede5", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <h4 className="mb-0"><i className="bi bi-person-badge me-2"></i>Gestión de Clientes</h4>
              <div className="d-flex gap-2">
                <button className="btn btn-dorado" onClick={() => setMostrarInactivos(!mostrarInactivos)}>{mostrarInactivos ? 'Ver activos' : 'Ver inactivos'}</button>
                {canCreate && <button className="btn btn-verdeAgua" onClick={handleAgregarClick}><i className="bi bi-plus-lg"></i> Agregar cliente</button>}
              </div>
            </div>
            <div className="card-body">
              <div className="mb-3"><input type="text" className="form-control" placeholder="Buscar por nombre o documento..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
              <div className="table-responsive" style={{ overflow: 'visible' }}>
                <table className="table table-striped table-hover align-middle">
                  <thead><tr><th>Tipo Doc</th><th>Número Doc</th><th>Nombre</th><th>Apellido</th><th>Teléfono</th><th>Email</th><th>Activo</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {clientes.map(c => (
                      <tr key={c.idCliente}>
                        <td>{tiposDocumento.find(td => td.idTipoDoc === c.idTipoDoc)?.nombre || c.idTipoDoc}</td>
                        <td>{c.numeroDoc}</td>
                        <td>{c.nombre}</td>
                        <td>{c.apellido}</td>
                        <td>{c.telefono}</td>
                        <td>{c.mail}</td>
                        <td>{c.activo === 1 ? 'Activo' : 'Inactivo'}</td>
                        <td style={{ position: 'relative', overflow: 'visible' }}>
                            <div className="d-flex align-items-center gap-2" style={{ overflow: 'visible' }}>
                            {canView && <button className="btn btn-sm btn-verdeAgua fw-bold" onClick={() => handleConsultar(c)}><i className="bi bi-search me-1"></i>Consultar</button>}
                            <button className="btn btn-sm btn-azul fw-bold" onClick={async () => { try { const res = await fetch(`${API_URL}/${c.idCliente}/historial-ordenes`); const data = await res.json().catch(()=>[]); setHistorialOrdenes(Array.isArray(data)?data:[]); setHistorialVisible(true);} catch(err){ console.warn(err); setMensaje('Error al cargar historial'); } }}><i className="bi bi-clock-history me-1"></i>Historial</button>
                            <div style={{ position: 'relative', overflow: 'visible' }}>
                              <button
                                ref={el => { if (el) menuAnchorRefs.current[c.idCliente] = el }}
                                className="btn btn-sm btn-outline-secondary"
                                onClick={(e) => { e.stopPropagation(); setOpenMenuFor(openMenuFor === c.idCliente ? null : c.idCliente); }}
                                aria-expanded={openMenuFor === c.idCliente}
                                style={{ backgroundColor: '#ffffff', zIndex: 5, minWidth: 36 }}
                              ><i className="bi bi-three-dots-vertical"></i></button>
                              {openMenuFor === c.idCliente && (
                                <ActionMenuPortal anchorEl={menuAnchorRefs.current[c.idCliente]} onClose={() => setOpenMenuFor(null)} onModificar={() => { setOpenMenuFor(null); c.activo && (canModify ? handleModificar(c) : setMensaje('No tenés permiso para modificar clientes.')) }} onEliminar={() => { setOpenMenuFor(null); c.idCliente && (canDelete ? handleEliminar(c.idCliente) : setMensaje('No tenés permiso para eliminar clientes.')) }} onReactivar={() => { setOpenMenuFor(null); c.idCliente && (canDelete ? handleReactivar(c.idCliente) : setMensaje('No tenés permiso para reactivar clientes.')) }} activo={c.activo} canModify={canModify} canDelete={canDelete} />
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {clientes.length === 0 && <div className="text-center text-muted py-4">No hay clientes registrados.</div>}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modal */}
      {modalVisible && (
        <div className="modal" style={{ display: 'block' }}>
          <div className="modal-dialog" style={{ maxWidth: '100vw' }}>
            <div className="modal-content" style={{ width: '100vw', maxWidth: '100vw' }}>
              <div className="modal-header">
                <h5 className="modal-title">{modalModo === 'consultar' ? <><i className="bi bi-search me-2"></i>Consultar cliente</> : modalModo === 'modificar' ? <><i className="bi bi-pencil-square me-2"></i>Modificar cliente</> : <><i className="bi bi-plus-lg me-2"></i>Nuevo cliente</>}</h5>
                {/* Botón para cerrar el modal con una 'X' */}
                <button type="button" className="btn-close" aria-label="Cerrar" onClick={() => setModalVisible(false)}></button>
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <form className="form-container" onSubmit={modalModo === 'modificar' ? handleUpdate : modalModo === 'alta' ? handleSubmit : undefined}>
                  <fieldset style={{ border: 'none' }}>
                    <legend><i className="bi bi-person-vcard me-2"></i>Datos del cliente</legend>
                    <h6 className="fw-bold mt-3 mb-2 border-bottom pb-1"><i className="bi bi-person-lines-fill me-2"></i>Datos personales</h6>
                    <div className="row g-4">
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label><i className="bi bi-card-list me-2"></i>Tipo de documento</label>
                          <select name="idTipoDoc" value={modalModo === 'consultar' ? clienteActual?.idTipoDoc ?? '' : form.idTipoDoc} onChange={handleChange} className="form-control" required disabled={modalModo === 'consultar'} style={{ backgroundColor: modalModo === 'consultar' ? '#dee2e6' : 'white' }}>
                            <option value="">Seleccione tipo de documento</option>
                            {tiposDocumento.map(td => <option key={td.idTipoDoc} value={td.idTipoDoc}>{td.nombre}</option>)}
                          </select>
                          {formErrors.idTipoDoc && <div className="input-error-message">{formErrors.idTipoDoc}</div>}
                        </div>
                        <div className="mb-3">
                          <label><i className="bi bi-hash me-2"></i>Número de documento</label>
                          <input type="text" name="numeroDoc" value={modalModo === 'consultar' ? clienteActual?.numeroDoc ?? '' : form.numeroDoc} onChange={handleChange} required className="form-control" disabled={modalModo === 'consultar'} style={{ backgroundColor: modalModo === 'consultar' ? '#dee2e6' : 'white' }} />
                          {formErrors.numeroDoc && <div className="input-error-message">{formErrors.numeroDoc}</div>}
                          {dupChecking && <div className="small text-muted">Verificando documento...</div>}
                          {duplicateExists && <div className="input-error-message">{duplicateMsg}</div>}
                        </div>
                      </div>
                      <div className="col-12 col-md-6">
                        <div className="mb-3"><label><i className="bi bi-person me-2"></i>Nombre</label><input type="text" name="nombre" value={modalModo === 'consultar' ? clienteActual?.nombre ?? '' : form.nombre} onChange={handleChange} required className="form-control" readOnly={modalModo === 'consultar'} style={{ backgroundColor: modalModo === 'consultar' ? '#dee2e6' : 'white' }} />{formErrors.nombre && <div className="input-error-message">{formErrors.nombre}</div>}</div>
                        <div className="mb-3"><label><i className="bi bi-person me-2"></i>Apellido</label><input type="text" name="apellido" value={modalModo === 'consultar' ? clienteActual?.apellido ?? '' : form.apellido} onChange={handleChange} required className="form-control" readOnly={modalModo === 'consultar'} style={{ backgroundColor: modalModo === 'consultar' ? '#dee2e6' : 'white' }} />{formErrors.apellido && <div className="input-error-message">{formErrors.apellido}</div>}</div>
                      </div>
                    </div>
                    <h6 className="fw-bold mt-4 mb-2 border-bottom pb-1"><i className="bi bi-telephone me-2"></i>Datos de contacto</h6>
                    <div className="row g-4"><div className="col-12 col-md-6"><div className="mb-3"><label><i className="bi bi-telephone me-2"></i>Teléfono</label><input type="text" name="telefono" value={modalModo === 'consultar' ? clienteActual?.telefono ?? '' : form.telefono} onChange={handleChange} required className="form-control" readOnly={modalModo === 'consultar'} style={{ backgroundColor: modalModo === 'consultar' ? '#dee2e6' : 'white' }} />{formErrors.telefono && <div className="input-error-message">{formErrors.telefono}</div>}</div></div>
                    <div className="col-12 col-md-6"><div className="mb-3"><label><i className="bi bi-envelope me-2"></i>Email</label><input type="email" name="mail" value={modalModo === 'consultar' ? clienteActual?.mail ?? '' : form.mail} onChange={handleChange} required className="form-control" readOnly={modalModo === 'consultar'} style={{ backgroundColor: modalModo === 'consultar' ? '#dee2e6' : 'white' }} />{formErrors.mail && <div className="input-error-message">{formErrors.mail}</div>}</div></div></div>
                  </fieldset>
                  {mensaje && <div className="alert alert-danger">{mensaje}</div>}
                  {(modalModo === 'modificar' || modalModo === 'alta') && (
                    <div className="d-flex flex-column flex-md-row justify-content-end gap-2 mt-3">
                      <button type="submit" className="btn btn-azul fw-bold" disabled={dupChecking || duplicateExists || isSaving}>
                        {isSaving ? (
                          <><i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>Guardando...</>
                        ) : (
                          <><i className="bi bi-save me-1"></i>{modalModo === 'modificar' ? 'Guardar cambios' : 'Guardar'}</>
                        )}
                      </button>
                      <button type="button" className="btn btn-dorado fw-bold" onClick={() => setModalVisible(false)}><i className="bi bi-x-circle me-1"></i>Cancelar</button>
                    </div>
                  )}
                </form>
              </div>
              {modalModo === 'consultar' && (<div className="modal-footer"><button className="btn btn-dorado fw-bold" onClick={() => setModalVisible(false)}><i className="bi bi-x-circle me-1"></i>Cerrar</button></div>)}
            </div>
          </div>
        </div>
      )}

      {historialVisible && (<div className="modal" style={{ display: 'block' }}><div className="modal-dialog modal-lg modal-dialog-centered"><div className="modal-content"><div className="modal-header"><h5 className="modal-title"><i className="bi bi-clock-history me-2"></i>Historial de Órdenes</h5><button className="btn-close" onClick={() => setHistorialVisible(false)}></button></div><div className="modal-body">{historialOrdenes.length === 0 ? (<div className="text-muted">No se encontraron órdenes para este cliente.</div>) : (<div className="table-responsive"><table className="table table-sm"><thead><tr><th>Nro Orden</th><th>Fecha</th><th>Dispositivo</th><th>Diagnóstico</th><th>Precio Total</th></tr></thead><tbody>{historialOrdenes.map(o => (<tr key={o.nroDeOrden}><td>{o.nroDeOrden}</td><td>{o.fecha}</td><td>{o.dispositivo_info}</td><td>{o.diagnostico}</td><td>{o.precioTotal}</td></tr>))}</tbody></table></div>)}</div><div className="modal-footer"><button className="btn btn-dorado" onClick={() => setHistorialVisible(false)}>Cerrar</button></div></div></div></div>)}

  <ConfirmModal open={confirmDeleteCliente.open} title="Confirmar eliminación" message="¿Estás seguro de eliminar este cliente?" onCancel={confirmDeleteClienteCancel} onConfirm={confirmDeleteClienteConfirm} />
  <ConfirmModal open={bloqueoModal.open} title="No se puede eliminar" message={bloqueoModal.message} onCancel={() => setBloqueoModal({ open: false, message: '' })} onConfirm={() => setBloqueoModal({ open: false, message: '' })} />
  <ResultModal open={resultModal.open} title={resultModal.title} message={resultModal.message} success={resultModal.success} onClose={() => setResultModal(prev => ({ ...prev, open: false }))} />
    </div>
  );
}

function ActionMenuPortal({ anchorEl, onClose, onModificar, onEliminar, onReactivar, activo, canModify = true, canDelete = true }) {
  const [pos, setPos] = React.useState({ left: 0, top: 0, transformOrigin: 'top right' });
  useEffect(() => { if (!anchorEl) return; const rect = anchorEl.getBoundingClientRect(); const menuWidth = 160; const left = rect.right - menuWidth; const top = rect.bottom + 6; const spaceBelow = window.innerHeight - rect.bottom; const menuHeight = 120; if (spaceBelow < menuHeight) setPos({ left: Math.max(8, left), top: rect.top - menuHeight - 6, transformOrigin: 'bottom right' }); else setPos({ left: Math.max(8, left), top: top, transformOrigin: 'top right' }); }, [anchorEl]);
  React.useEffect(() => { const onDocClick = (e) => { if (!anchorEl) return; const node = document.getElementById('action-menu-portal'); if (node && !node.contains(e.target) && !anchorEl.contains(e.target)) onClose(); }; const onEsc = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('mousedown', onDocClick); document.addEventListener('keydown', onEsc); return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onEsc); }; }, [anchorEl, onClose]);
  if (!anchorEl) return null;
  return ReactDOM.createPortal(
    <div id="action-menu-portal" style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 2147483648, minWidth: 140 }}>
      <div className="card" style={{ overflow: 'visible' }}>
        <ul className="list-group list-group-flush p-2">
          {activo && canModify && (<li className="list-group-item border-0 p-0 mb-1"><button className={`btn btn-sm w-100 ${activo ? 'btn-dorado' : 'btn-secondary'}`} onClick={onModificar}>Modificar</button></li>)}
          {activo && canDelete && (<li className="list-group-item border-0 p-0"><button className="btn btn-sm btn-rojo w-100 fw-bold" onClick={onEliminar}>Eliminar</button></li>)}
          {!activo && canDelete && (<li className="list-group-item border-0 p-0"><button className="btn btn-sm btn-verdeAgua w-100 fw-bold" onClick={onReactivar}>Reactivar</button></li>)}
        </ul>
      </div>
    </div>, document.body
  );
}

// Render ConfirmModal at module root level inside component so it can be triggered from action menu
// (This is appended to the end of the file but still within the component scope.)

