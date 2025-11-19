import React, { useEffect, useState, useCallback } from "react";
import MenuLateral from './MenuLateral';
import ConfirmModal from './ConfirmModal';
import { usePermission } from '../auth/PermissionContext';
import { hasPermission } from '../utils/permissions';

const colores = { azul: '#1f3345', dorado: '#c78f57', rojo: '#b54745', verdeAgua: '#85abab', beige: '#f0ede5', mentaSuave: '#c6e8e8' };
const API_URL = "http://localhost:5000/proveedores";

function Proveedores() {
  const permCtx = usePermission();
  const identity = permCtx ? permCtx.identity : null;
  // permiso 16 = ver/listar proveedores (route), reserve 17..19 for create/modify/delete
  const canView = hasPermission(identity, 16);
  const canCreate = hasPermission(identity, 17);
  const canModify = hasPermission(identity, 18);
  const canDelete = hasPermission(identity, 19);
  const [proveedores, setProveedores] = useState([]);
  const [form, setForm] = useState({
    cuil: "",
    razonSocial: "",
    telefonoResponsable: "",
    direccion: "",
    nombreResponsable: "",
    mailResponsable: "",
  });
  const [formErrors, setFormErrors] = useState({});
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  // Modal to show full list of active providers
  const [activeModalOpen, setActiveModalOpen] = useState(false);
  const [activeProveedores, setActiveProveedores] = useState([]);

  const openActiveProvidersModal = async () => {
    setActiveModalOpen(true);
    try {
      // Fetch all providers (no activos filter) so the modal shows the complete list
      const res = await fetch(API_URL);
      const data = await res.json();
      setActiveProveedores(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Proveedores: openActiveProvidersModal error', err);
      setMensaje("Error al cargar proveedores");
    }
  };

  const closeActiveProvidersModal = () => setActiveModalOpen(false);
  
  const [mensaje, setMensaje] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [, setMostrarFormulario] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalModo, setModalModo] = useState('consultar'); // 'consultar' | 'modificar'
  const [proveedorActual, setProveedorActual] = useState(null);
  const [, setModalErrors] = useState({});
  const [, setFormMode] = useState("alta"); // "alta" | "modificar"
  const [editId, setEditId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dupChecking, setDupChecking] = useState(false);
  const [duplicateExists, setDuplicateExists] = useState(false);
  const [duplicateMsg, setDuplicateMsg] = useState("");
  const checkTimer = React.useRef(null);
  const [confirmDeleteProveedor, setConfirmDeleteProveedor] = useState({ open: false, cuil: null });

  // Cargar proveedores
  const fetchVisibleProveedores = useCallback(() => {
    if (!canView) return; // don't load if user can't view
    const params = new URLSearchParams({ activos: mostrarInactivos ? "false" : "true", ...(searchTerm && { search: searchTerm }) });
    fetch(`${API_URL}?${params}`)
      .then(res => res.json())
      .then(data => setProveedores(data))
      .catch(err => { console.warn('Proveedores: fetchVisibleProveedores error', err); setMensaje("Error al cargar proveedores"); });
  }, [canView, mostrarInactivos, searchTerm]);

  useEffect(() => {
    fetchVisibleProveedores();
  }, [fetchVisibleProveedores]);

  const handleChange = e => {
    const { name, value } = e.target;
    // If modal is open and we're editing/consulting proveedorActual, update that object instead
    if (modalVisible && (modalModo === 'modificar' || modalModo === 'consultar' || modalModo === 'alta')) {
      // keep form in sync for alta/modificar flows
      setForm(prev => ({ ...prev, [name]: value }));
      setFormErrors(validarProveedor({ ...form, [name]: value }));
    } else {
      setForm({ ...form, [name]: value });
      setFormErrors(validarProveedor({ ...form, [name]: value }));
    }
    // if editing CUIL, debounce a duplicate check
    if (name === 'cuil') {
      setDuplicateExists(false);
      setDuplicateMsg("");
      if (checkTimer.current) clearTimeout(checkTimer.current);
      const updatedCuil = value;
      checkTimer.current = setTimeout(() => {
        // only verify if it looks like a valid cuil (11 digits)
        if (/^\d{11}$/.test(updatedCuil)) {
          verificarDuplicado(updatedCuil);
        }
      }, 500);
    }
  };

  // limpiar timer on unmount
  React.useEffect(() => {
    return () => { if (checkTimer.current) clearTimeout(checkTimer.current); };
  }, []);

  function validarProveedor(obj) {
    const errors = {};
    if (!obj.cuil || !/^\d{11}$/.test(obj.cuil)) errors.cuil = "El CUIL/CUIT debe tener 11 dígitos numéricos.";
    if (!obj.razonSocial || obj.razonSocial.trim().length < 2) errors.razonSocial = "La razón social es obligatoria y debe tener al menos 2 caracteres.";
    if (!obj.telefonoResponsable || obj.telefonoResponsable.trim().length < 6 || !/^\d{6,}$/.test(obj.telefonoResponsable.trim())) errors.telefonoResponsable = "El teléfono del responsable es obligatorio, debe contener solo números y tener al menos 6 dígitos.";
    if (obj.mailResponsable && !/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(obj.mailResponsable)) errors.mailResponsable = "El email del responsable no es válido.";
    return errors;
  }

  // Alta
  function handleSubmit(e) {
    e.preventDefault();
    if (!canCreate) { setMensaje('No tenés permiso para crear proveedores.'); return; }
    const errors = validarProveedor(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMensaje("Por favor, corrige los errores antes de continuar.");
      return;
    }
    if (duplicateExists) {
      setMensaje('Ya existe un proveedor con ese CUIL/CUIT.');
      return;
    }
    setIsSaving(true);
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al crear proveedor");
        return data;
      })
      .then(() => {
        setForm({ cuil: "", razonSocial: "", telefono: "" });
        setForm({ cuil: "", razonSocial: "", telefonoResponsable: "", direccion: "", nombreResponsable: "", mailResponsable: "" });
        setMostrarFormulario(false);
        setMensaje("");
        fetch(`${API_URL}?activos=${mostrarInactivos ? "false" : "true"}`)
          .then(res => res.json())
          .then(data => setProveedores(data));
      })
      .catch(err => { console.warn('Proveedores: submit error', err); setMensaje(err.message); })
      .finally(() => setIsSaving(false));
  }

  function handleDelete(cuil) {
    if (!canDelete) { setMensaje('No tenés permiso para eliminar proveedores.'); return; }
    // open confirm modal
    setConfirmDeleteProveedor({ open: true, cuil });
  }

  const confirmDeleteProveedorCancel = () => setConfirmDeleteProveedor({ open: false, cuil: null });

  const confirmDeleteProveedorConfirm = () => {
    const cuil = confirmDeleteProveedor.cuil;
    fetch(`${API_URL}/${cuil}`, { method: "DELETE" })
      .then(() => {
        fetch(`${API_URL}?activos=${mostrarInactivos ? "false" : "true"}`)
          .then(res => res.json())
          .then(data => setProveedores(data));
      })
      .finally(() => setConfirmDeleteProveedor({ open: false, cuil: null }));
  };

  function handleReactivar(cuil) {
    if (!canDelete) { setMensaje('No tenés permiso para reactivar proveedores.'); return; }
    fetch(`${API_URL}/${cuil}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: 1 }) })
      .then(() => fetch(`${API_URL}?activos=${mostrarInactivos ? "false" : "true"}`).then(res => res.json()).then(data => setProveedores(data)));
  }

  const handleAgregarClick = () => {
    if (!canCreate) { setMensaje('No tenés permiso para crear proveedores.'); return; }
    setFormMode("alta");
    setProveedorActual(null);
    setModalModo("alta");
    setModalVisible(true);
    setMensaje("");
    setFormErrors({});
    setForm({
      cuil: "",
      razonSocial: "",
      telefonoResponsable: "",
      direccion: "",
      nombreResponsable: "",
      mailResponsable: "",
    });
  };

  const handleModificar = (prov) => {
    if (!canModify) { setModalModo('consultar'); setModalVisible(true); setProveedorActual(prov); setMensaje('No tenés permiso para modificar proveedores. Abriendo en modo consulta.'); return; }
    setFormMode("modificar");
    setEditId(prov.cuil);
    setProveedorActual({
      ...prov,
      cuil: prov.cuil || "",
      razonSocial: prov.razonSocial || "",
      telefonoResponsable: prov.telefonoResponsable || prov.telefono || "",
      direccion: prov.direccion || "",
      nombreResponsable: prov.nombreResponsable || "",
      mailResponsable: prov.mailResponsable || "",
    });
    setModalModo("modificar");
    setModalVisible(true);
    setMensaje("");
    setModalErrors({});
    setForm({
      cuil: prov.cuil || "",
      razonSocial: prov.razonSocial || "",
      telefonoResponsable: prov.telefonoResponsable || prov.telefono || "",
      direccion: prov.direccion || "",
      nombreResponsable: prov.nombreResponsable || "",
      mailResponsable: prov.mailResponsable || "",
    });
  };

  const handleConsultar = (prov) => {
    if (!canView) { setMensaje('No tenés permiso para ver proveedores.'); return; }
    setProveedorActual({ ...prov, cuil: prov.cuil || "", razonSocial: prov.razonSocial || "", telefonoResponsable: prov.telefonoResponsable || prov.telefono || "", direccion: prov.direccion || "", nombreResponsable: prov.nombreResponsable || "", mailResponsable: prov.mailResponsable || "" });
    setModalModo('consultar');
    setModalVisible(true);
    setMensaje("");
  }

  // Not currently referenced directly by ESLint-detected JSX paths — keep as intentionally-unused (prefixed) to silence no-unused-vars
  function _handleModalClose() {
    setModalVisible(false);
    setProveedorActual(null);
    setModalErrors({});
    setMensaje("");
  }

  function _handleModalFieldChange(e) {
    const { name, value } = e.target;
    const nuevo = { ...proveedorActual, [name]: name === "activo" ? Number(value) : value };
    setProveedorActual(nuevo);
    // Keep form in sync for validations that rely on formErrors
    setForm(prev => ({ ...prev, [name]: value }));
    setModalErrors(validarProveedor({ ...nuevo, cuil: proveedorActual?.cuil }));
    setMensaje("");
    // debounce check when changing cuil in modal
    if (name === 'cuil') {
      setDuplicateExists(false);
      setDuplicateMsg('');
      if (checkTimer.current) clearTimeout(checkTimer.current);
      const updated = value;
      checkTimer.current = setTimeout(() => {
        if (/^\d{11}$/.test(updated)) {
          verificarDuplicado(updated);
        }
      }, 500);
    }
  }

  function _handleModalSave(e) {
    e.preventDefault();
  // No enviar cuil en el body, solo los campos editables
  const { cuil: _cuil, telefono: _telefono, ...rest } = proveedorActual;
    const proveedorParaEnviar = {
      ...rest,
      telefonoResponsable: proveedorActual.telefonoResponsable ?? proveedorActual.telefono ?? null,
      direccion: proveedorActual.direccion ?? null,
      nombreResponsable: proveedorActual.nombreResponsable ?? null,
      mailResponsable: proveedorActual.mailResponsable ?? null,
      activo: Number(proveedorActual.activo)
    };
    const errors = validarProveedor({ ...proveedorActual, cuil: proveedorActual.cuil });
    setModalErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMensaje("Por favor, corrige los errores antes de continuar.");
      return;
    }
  if (!canModify) { setMensaje('No tenés permiso para modificar proveedores.'); return; }
    fetch(`${API_URL}/${proveedorActual.cuil}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proveedorParaEnviar)
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al modificar proveedor");
        return data;
      })
      .then(() => {
        setModalVisible(false);
        setProveedorActual(null);
        setMensaje("");
        fetch(`${API_URL}?activos=${mostrarInactivos ? "false" : "true"}`)
          .then(res => res.json())
          .then(data => setProveedores(data));
      })
  .catch(err => { console.warn('Proveedores: handleModalSave error', err); setMensaje(err.message); });
  }

  const fetchProveedores = () => {
    fetch(API_URL)
      .then(res => res.json())
      .then(data => setProveedores(Array.isArray(data) ? data : []))
      .catch(err => { console.warn('Proveedores: fetchProveedores error', err); setMensaje("Error al cargar proveedores"); });
  };

  async function verificarDuplicado(cuil) {
    setDupChecking(true);
    setDuplicateExists(false);
    setDuplicateMsg("");
    try {
      const res = await fetch(`${API_URL}/existe?cuil=${encodeURIComponent(cuil)}`);
      if (!res.ok) return;
      const j = await res.json();
      if (j.exists) {
        // if editing, allow same record (don't count as duplicate)
        if (editId && String(editId) === String(cuil)) {
          setDuplicateExists(false);
          setDuplicateMsg("");
        } else {
          setDuplicateExists(true);
          setDuplicateMsg('Ya existe un proveedor con ese CUIL/CUIT.');
        }
      } else {
        setDuplicateExists(false);
        setDuplicateMsg("");
      }
    } catch (err) {
      console.warn('verificarDuplicado error', err);
    } finally {
      setDupChecking(false);
    }
  }

  const handleCancelar = () => {
    setModalVisible(false);
    setMensaje("");
    setForm({
      cuil: "",
      razonSocial: "",
      telefonoResponsable: "",
      direccion: "",
      nombreResponsable: "",
      mailResponsable: "",
      activo: 1,
    });
    setFormMode("alta");
    setFormErrors({});
  };

  const handleUpdate = async e => {
    e.preventDefault();
    const errors = validarProveedor(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMensaje("Por favor, corrige los errores antes de continuar.");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`${API_URL}/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const resultado = await res.json().catch(() => ({}));
      if (res.ok) {
        setModalVisible(false);
        setForm({
          cuil: "",
          razonSocial: "",
          telefonoResponsable: "",
          direccion: "",
          nombreResponsable: "",
          mailResponsable: "",
        });
        setEditId(null);
        fetchProveedores();
      } else {
        setMensaje(resultado.error || resultado.detail || resultado.mensaje || "Error desconocido del servidor");
      }
    } catch (err) {
      setMensaje("Error de red: " + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="container-fluid main-background" style={{ minHeight: '100vh' }}>
      <div className="row flex-nowrap">
        <MenuLateral />
        <main className="col-12 col-md-10 pt-4 px-2 px-md-4 d-flex flex-column" style={{ background: 'white', borderRadius: 16, boxShadow: `0 4px 24px 0 ${colores.azul}22`, minHeight: '90vh' }}>
          <div className="card shadow-sm mb-4" style={{ border: `1.5px solid ${colores.azul}`, borderRadius: 16, background: "var(--color-beige)" }}>
            <div className="card-header d-flex justify-content-between align-items-center" style={{ background: colores.azul, color: colores.beige, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <h4 className="mb-0"><i className="bi bi-truck me-2"></i>Gestión de Proveedores</h4>
              <div className="d-flex gap-2">
                <button
                  className="btn btn-dorado"
                  onClick={() => setMostrarInactivos(!mostrarInactivos)}
                >
                  {mostrarInactivos ? 'Ver activos' : 'Ver inactivos'}
                </button>
                <button
                  className="btn btn-verdeAgua"
                  onClick={openActiveProvidersModal}
                >
                  <i className="bi bi-list-ul me-1"></i>Ver todos los proveedores
                </button>
                
                {canCreate && <button className="btn btn-verdeAgua" onClick={handleAgregarClick}><i className="bi bi-plus-lg"></i> Agregar proveedor</button>}
              </div>
            </div>
            <div className="card-body">
              <div className="mb-3">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Buscar por razón social o CUIT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                
              </div>
              <div className="table-responsive" style={{ overflow: 'visible' }}>
                <table className="table table-striped table-hover align-middle">
                  <thead>
                    <tr>
                      <th>CUIL/CUIT</th>
                      <th>Razón Social</th>
                        <th>Teléfono Responsable</th>
                      <th>Activo</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proveedores.map((prov) => (
                      <tr key={prov.cuil}>
                        <td>{prov.cuil}</td>
                        <td>{prov.razonSocial}</td>
                        <td>{prov.telefonoResponsable || prov.telefono}</td>
                        <td>{prov.activo === 1 ? "Activo" : "Inactivo"}</td>
                        <td>
                          {canView && <button className="btn btn-sm btn-verdeAgua fw-bold me-1" onClick={() => handleConsultar(prov)}><i className="bi bi-search me-1"></i>Consultar</button>}
                          {prov.activo === 1 && canModify && (
                            <button className={`btn btn-sm fw-bold me-1 btn-dorado`} onClick={() => handleModificar(prov)}><i className="bi bi-pencil-square me-1"></i>Modificar</button>
                          )}
                          {prov.activo === 1 && canDelete && (
                            <button className="btn btn-sm btn-rojo fw-bold" onClick={() => handleDelete(prov.cuil)}><i className="bi bi-trash me-1"></i>Eliminar</button>
                          )}
                          {prov.activo !== 1 && canDelete && (
                            <button className="btn btn-sm btn-verdeAgua fw-bold" onClick={() => handleReactivar(prov.cuil)}><i className="bi bi-arrow-clockwise me-1"></i>Reactivar</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {proveedores.length === 0 && (
                  <div className="text-center text-muted py-4">No hay proveedores registrados.</div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
      {/* Modal para consultar, modificar o alta */}
      {modalVisible && (
        <div className="modal" style={{ display: "block" }}>
          <div className="modal-dialog" style={{ maxWidth: "100vw" }}>
            <div className="modal-content" style={{ width: "100vw", maxWidth: "100vw" }}>
              <div className="modal-header">
                <h5 className="modal-title">
                  {modalModo === 'consultar'
                    ? <><i className="bi bi-search me-2"></i>Consultar proveedor</>
                    : modalModo === 'modificar'
                    ? <><i className="bi bi-pencil-square me-2"></i>Modificar proveedor</>
                    : <><i className="bi bi-plus-lg me-2"></i>Nuevo proveedor</>}
                </h5>
                <button type="button" className="btn-close" onClick={() => setModalVisible(false)}></button>
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <form
                  className="form-container"
                  onSubmit={
                    modalModo === "modificar"
                      ? handleUpdate
                      : modalModo === "alta"
                      ? handleSubmit
                      : undefined
                  }
                >
                  <fieldset style={{ border: "none" }}>
                    <legend>
                      <i className="bi bi-person-badge me-2"></i>Datos del proveedor
                    </legend>
                    {/* Two-column responsive layout: left = identificación, right = responsable */}
                    <div className="row g-4">
                      <div className="col-12 col-md-6">
                        <h6 className="fw-bold mt-1 mb-2 border-bottom pb-1">
                          <i className="bi bi-credit-card-2-front me-2"></i>Datos de identificación
                        </h6>
                        <div className="mb-3">
                          <label className="form-label">
                            <i className="bi bi-credit-card-2-front me-2"></i>CUIL/CUIT
                          </label>
                          <input
                            type="text"
                            name="cuil"
                            value={
                              modalModo === "consultar"
                                ? proveedorActual?.cuil ?? ""
                                : form.cuil
                            }
                            onChange={handleChange}
                            required
                            className="form-control"
                            disabled={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                          {formErrors.cuil && <div className="input-error-message">{formErrors.cuil}</div>}
                          {dupChecking && <div className="small text-muted">Verificando CUIL...</div>}
                          {duplicateExists && <div className="input-error-message">{duplicateMsg}</div>}
                        </div>

                        <div className="mb-3">
                          <label className="form-label">
                            <i className="bi bi-building me-2"></i>Razón Social
                          </label>
                          <input
                            type="text"
                            name="razonSocial"
                            value={
                              modalModo === "consultar"
                                ? proveedorActual?.razonSocial ?? ""
                                : form.razonSocial
                            }
                            onChange={handleChange}
                            required
                            className="form-control"
                            readOnly={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                          {formErrors.razonSocial && <div className="input-error-message">{formErrors.razonSocial}</div>}
                        </div>

                        <div className="mb-3">
                          <label className="form-label">
                            <i className="bi bi-geo-alt me-2"></i>Dirección
                          </label>
                          <input
                            type="text"
                            name="direccion"
                            value={
                              modalModo === "consultar"
                                ? proveedorActual?.direccion ?? ""
                                : form.direccion
                            }
                            onChange={handleChange}
                            className="form-control"
                            readOnly={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                        </div>
                      </div>

                      <div className="col-12 col-md-6">
                        <h6 className="fw-bold mt-1 mb-2 border-bottom pb-1">
                          <i className="bi bi-person-lines-fill me-2"></i>Datos del responsable
                        </h6>
                        <div className="mb-3">
                          <label className="form-label">
                            <i className="bi bi-person me-2"></i>Nombre del responsable
                          </label>
                          <input
                            type="text"
                            name="nombreResponsable"
                            value={
                              modalModo === "consultar"
                                ? proveedorActual?.nombreResponsable ?? ""
                                : form.nombreResponsable
                            }
                            onChange={handleChange}
                            className="form-control"
                            readOnly={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                        </div>

                        <div className="mb-3">
                          <label className="form-label">
                            <i className="bi bi-telephone me-2"></i>Teléfono del responsable
                          </label>
                          <input
                            type="text"
                            name="telefonoResponsable"
                            value={
                              modalModo === "consultar"
                                ? proveedorActual?.telefonoResponsable ?? proveedorActual?.telefono ?? ""
                                : form.telefonoResponsable
                            }
                            onChange={handleChange}
                            required
                            className="form-control"
                            readOnly={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                          {formErrors.telefonoResponsable && <div className="input-error-message">{formErrors.telefonoResponsable}</div>}
                        </div>

                        <div className="mb-3">
                          <label className="form-label">
                            <i className="bi bi-envelope me-2"></i>Email del responsable
                          </label>
                          <input
                            type="email"
                            name="mailResponsable"
                            value={
                              modalModo === "consultar"
                                ? proveedorActual?.mailResponsable ?? ""
                                : form.mailResponsable
                            }
                            onChange={handleChange}
                            className="form-control"
                            readOnly={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                          {formErrors.mailResponsable && <div className="input-error-message">{formErrors.mailResponsable}</div>}
                        </div>
                      </div>
                    </div>
                  </fieldset>
                  {mensaje && (
                    <div className="alert alert-danger">{mensaje}</div>
                  )}
                  {(modalModo === "modificar" || modalModo === "alta") && (
                    <div className="d-flex flex-column flex-md-row justify-content-end gap-2 mt-3">
                      <button type="submit" className="btn btn-azul fw-bold" disabled={dupChecking || duplicateExists || isSaving}>
                        {isSaving ? (
                          <><i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>Guardando...</>
                        ) : (
                          <><i className="bi bi-save me-1"></i>{modalModo === "modificar" ? "Guardar cambios" : "Guardar"}</>
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-dorado fw-bold"
                        onClick={handleCancelar}
                      >
                        <i className="bi bi-x-circle me-1"></i>Cancelar
                      </button>
                    </div>
                  )}
                </form>
              </div>
              {modalModo === "consultar" && (
                <div className="modal-footer">
                  <button className="btn btn-dorado fw-bold" onClick={() => setModalVisible(false)}>
                    <i className="bi bi-x-circle me-1"></i>Cerrar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Modal: listado completo de proveedores activos */}
      {activeModalOpen && (
        <div className="modal" style={{ display: 'block' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Todos los proveedores</h5>
                <button type="button" className="btn-close" aria-label="Cerrar" onClick={closeActiveProvidersModal}></button>
              </div>
              <div className="modal-body">
                <div className="table-responsive">
                  <table className="table table-striped table-hover align-middle">
                    <thead>
                      <tr>
                        <th>CUIL</th>
                        <th>Razón social</th>
                        <th>Teléfono</th>
                        <th>Responsable</th>
                        <th>Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeProveedores.map(p => (
                        <tr key={p.cuil}>
                          <td>{p.cuil}</td>
                          <td>{p.razonSocial}</td>
                          <td>{p.telefonoResponsable || p.telefono}</td>
                          <td>{p.nombreResponsable}</td>
                          <td>{p.mailResponsable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {activeProveedores.length === 0 && <div className="text-center py-3 text-muted">No hay proveedores activos.</div>}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-dorado fw-bold" onClick={closeActiveProvidersModal}><i className="bi bi-x-circle me-1"></i>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <ConfirmModal
        open={confirmDeleteProveedor.open}
        title="Confirmar eliminación"
        message="¿Está seguro de que desea eliminar este proveedor? Esta acción también removerá sus relaciones asociadas."
        onCancel={confirmDeleteProveedorCancel}
        onConfirm={confirmDeleteProveedorConfirm}
      />
    </div>
  );
}

export default Proveedores;
