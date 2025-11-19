import React, { useEffect, useState } from "react";
import MenuLateral from './MenuLateral';
import ConfirmModal from './ConfirmModal';
import { usePermission } from '../auth/PermissionContext';
import { hasPermission } from '../utils/permissions';

const API_URL = "http://localhost:5000/servicios";
const REPUESTOS_URL = "http://localhost:5000/repuestos";
const colores = {
  azul: '#1f3345',
  dorado: '#c78f57',
  rojo: '#b54745',
  verdeAgua: '#85abab',
  beige: '#f0ede5'
};

export default function Servicios() {
  const permCtx = usePermission();
  const identity = permCtx ? permCtx.identity : null;
  // permiso 27 = ver/listar servicios; reserve 28..30 for create/modify/delete
  const canView = hasPermission(identity, 27);
  const canCreate = hasPermission(identity, 28);
  const canModify = hasPermission(identity, 29);
  const canDelete = hasPermission(identity, 30);
  const isSalesAdmin = identity?.idCargo === 3; // Asistente de ventas
  const isSupervisor = identity?.idCargo === 1; // Supervisor / administrador (assumption: idCargo 1)
  const isTecnico = identity?.idCargo === 2; // Técnico -> idCargo 2
  const canDeleteEffective = canDelete && !isSalesAdmin;

  const [servicios, setServicios] = useState([]);
  const [repuestos, setRepuestos] = useState([]);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalModo, setModalModo] = useState("alta"); // "alta" | "modificar" | "consultar"
  const [servicioActual, setServicioActual] = useState({
    idServicio: "",
    descripcion: "",
    precioBase: "",
    activo: 1,
    repuestos: []
  });
  const [originalRepuestos, setOriginalRepuestos] = useState([]);
  const [mensaje, setMensaje] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  // Services catalog modal (moved from Proveedores.jsx)
  const [servicesModalOpen, setServicesModalOpen] = useState(false);
  const [serviciosCatalogo, setServiciosCatalogo] = useState([]);

  const openServicesCatalogModal = async () => {
    setServicesModalOpen(true);
    try {
      const res = await fetch(API_URL);
      const data = await res.json();
      setServiciosCatalogo(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Servicios: error loading catalog', err);
      setMensaje('Error al cargar catálogo de servicios');
    }
  };

  const closeServicesCatalogModal = () => setServicesModalOpen(false);

  // Cargar servicios
  const fetchServicios = () => {
    fetch(`${API_URL}?activos=${mostrarInactivos ? 'false' : 'true'}`)
      .then(res => res.json())
      .then(data => setServicios(Array.isArray(data) ? data : []))
  .catch(err => { console.warn('Servicios: fetch servicios error', err); setMensaje("Error al cargar servicios"); });
  };

  // Cargar repuestos
  const fetchRepuestos = () => {
    fetch(REPUESTOS_URL)
      .then(res => res.json())
      .then(data => setRepuestos(Array.isArray(data) ? data : []))
  .catch(err => { console.warn('Servicios: fetch repuestos error', err); setMensaje("Error al cargar repuestos"); });
  };

  useEffect(() => {
    if (!canView) return;
    fetchServicios();
    fetchRepuestos();
    // eslint-disable-next-line
  }, [mostrarInactivos]);


  // Modal handlers
  const handleAgregarClick = () => {
    if (!canCreate || isTecnico) { setMensaje(isTecnico ? 'Acción no disponible para técnicos.' : 'No tenés permiso para crear servicios.'); return; }
    setServicioActual({
      idServicio: "",
      descripcion: "",
      precioBase: "",
      activo: 1,
      repuestos: []
    });
    setModalModo("alta");
    setModalVisible(true);
    setMensaje("");
  };

  const handleModificar = (servicio) => {
    if (!canModify) { setModalModo('consultar'); setModalVisible(true); setServicioActual(servicio); setMensaje('No tenés permiso para modificar servicios. Abriendo en modo consulta.'); return; }
    fetch(`${API_URL}/${servicio.idServicio}`)
      .then(res => res.json())
      .then(data => {
        setServicioActual({ ...data, repuestos: [] });
        return fetch(`${API_URL}/${servicio.idServicio}/repuestos`);
      })
      .then(res => res.json())
        .then(reps => {
        // cantidad is no longer provided by API; keep only idRepuesto
        setServicioActual(prev => ({ ...prev, repuestos: reps.map(r => ({ idRepuesto: r.idRepuesto })) }));
        setOriginalRepuestos(reps.map(r => ({ idRepuesto: r.idRepuesto })));
        setModalModo('modificar');
        setModalVisible(true);
        setMensaje("");
      });
  };

  const handleConsultar = (servicio) => {
    if (!canView) { setMensaje('No tenés permiso para ver servicios.'); return; }
    fetch(`${API_URL}/${servicio.idServicio}`)
      .then(res => res.json())
      .then(data => {
        setServicioActual({ ...data, repuestos: [] });
        return fetch(`${API_URL}/${servicio.idServicio}/repuestos`);
      })
      .then(res => res.json())
        .then(reps => {
        setServicioActual(prev => ({ ...prev, repuestos: reps.map(r => ({ idRepuesto: r.idRepuesto })) }));
        setModalModo('consultar');
        setModalVisible(true);
        setMensaje("");
      });
  };

  const [confirmDeleteServicio, setConfirmDeleteServicio] = useState({ open: false, id: null });
  const [confirmDeleteRepuesto, setConfirmDeleteRepuesto] = useState({ open: false, index: null });

  const handleEliminar = async (idServicio) => {
    if (!canDelete || isSalesAdmin) { setMensaje(isSalesAdmin ? 'Acción no disponible para Asistente de ventas.' : 'No tenés permiso para eliminar servicios.'); return; }
    setConfirmDeleteServicio({ open: true, id: idServicio });
  };

  const confirmDeleteServicioCancel = () => setConfirmDeleteServicio({ open: false, id: null });

  const confirmDeleteServicioConfirm = async () => {
    const id = confirmDeleteServicio.id;
    await fetch(`${API_URL}/${id}`, { method: "DELETE" });
    fetchServicios();
    setConfirmDeleteServicio({ open: false, id: null });
  };

  const _handleEliminarRepuestoClick = (index) => {
    // open confirm modal for the repuesto row
    setConfirmDeleteRepuesto({ open: true, index });
  };

  const confirmDeleteRepuestoCancel = () => setConfirmDeleteRepuesto({ open: false, index: null });

  const confirmDeleteRepuestoConfirm = () => {
    const idx = confirmDeleteRepuesto.index;
    if (idx === null || idx === undefined) return confirmDeleteRepuestoCancel();
    setServicioActual(prev => ({ ...prev, repuestos: prev.repuestos.filter((_, i) => i !== idx) }));
    setConfirmDeleteRepuesto({ open: false, index: null });
  };

  const handleReactivar = async (idServicio) => {
    if (!canDelete || isSalesAdmin) { setMensaje(isSalesAdmin ? 'Acción no disponible para Asistente de ventas.' : 'No tenés permiso para reactivar servicios.'); return; }
    try {
      const res = await fetch(`${API_URL}/${idServicio}/reactivar`, { method: "PUT" });
      if (!res.ok) throw new Error("Error al reactivar el servicio.");
      fetchServicios();
    } catch (err) {
      console.warn('Servicios: handleReactivar error', err);
      setMensaje(err.message);
    }
  };

  const handleChange = e => {
    setServicioActual({ ...servicioActual, [e.target.name]: e.target.value });
    setFormErrors(validarServicio({ ...servicioActual, [e.target.name]: e.target.value }));
  };

  function validarServicio(form) {
    const errors = {};
    if (!form.descripcion || form.descripcion.trim().length < 2) errors.descripcion = "La descripción es obligatoria y debe tener al menos 2 caracteres.";
    if (!form.precioBase || isNaN(Number(form.precioBase)) || Number(form.precioBase) < 0) errors.precioBase = "El precio base debe ser un número mayor o igual a 0.";
    // Remove the mandatory repuestos check
    // if (form.repuestos.length === 0) errors.repuestos = "Debe agregar al menos un repuesto.";
    if (modalModo !== 'consultar') {
      if (form.repuestos.length > 0) {
        const ids = form.repuestos.map(r => r.idRepuesto);
        if (new Set(ids).size !== ids.length) errors.repuestos = "No puede haber repuestos repetidos.";
        for (const r of form.repuestos) {
          if (!r.idRepuesto) errors.repuestoDetalle = "El repuesto es obligatorio.";
          // cantidad is not editable in the modal (defaults to 1), so skip validation here
        }
      }
    }
    return errors;
  }

  // Guardar alta
  const handleSubmit = async e => {
    e.preventDefault();
    const errors = validarServicio(servicioActual);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMensaje("Por favor, corrige los errores antes de continuar.");
      return;
    }
    setIsSaving(true);
    const servicioData = {
      descripcion: servicioActual.descripcion,
      precioBase: Number(servicioActual.precioBase)
    };
    const res = await fetch(`${API_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(servicioData),
    });
    const resultado = await res.json();
    if (res.ok) {
      const idServicio = resultado.idServicio;
      await Promise.all(servicioActual.repuestos.map(r =>
        fetch(`${API_URL}-repuestos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idServicio: idServicio, idRepuesto: r.idRepuesto })
        })
      ));
      setModalVisible(false);
      setServicioActual({
        idServicio: "",
        descripcion: "",
        precioBase: "",
        activo: 1,
        repuestos: []
      });
      fetchServicios();
    } else {
      setMensaje(resultado.error || resultado.detail || resultado.mensaje || "Error desconocido");
    }
    setIsSaving(false);
  };

  // Guardar modificación
  const handleGuardarModificacion = async e => {
    e.preventDefault();
    const errors = validarServicio(servicioActual);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMensaje("Por favor, corrige los errores antes de continuar.");
      return;
    }
    setIsSaving(true);
    const servicioData = {
      descripcion: servicioActual.descripcion,
      precioBase: Number(servicioActual.precioBase)
    };
    const res = await fetch(`${API_URL}/${servicioActual.idServicio}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(servicioData),
    });
    if (res.ok) {
      const repuestosAEliminar = originalRepuestos.filter(orig => !servicioActual.repuestos.some(r => r.idRepuesto === orig.idRepuesto));
      const repuestosParaUpsert = servicioActual.repuestos;

      const promesasEliminar = repuestosAEliminar.map(r => fetch(`${API_URL}-repuestos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idServicio: servicioActual.idServicio, idRepuesto: r.idRepuesto })
      }));

      const promesasUpsert = repuestosParaUpsert.map(r => fetch(`${API_URL}-repuestos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idServicio: servicioActual.idServicio, idRepuesto: r.idRepuesto })
      }));

      await Promise.all([...promesasEliminar, ...promesasUpsert]);
      setModalVisible(false);
      setServicioActual({
        idServicio: "",
        descripcion: "",
        precioBase: "",
        activo: 1,
        repuestos: []
      });
      fetchServicios();
    } else {
      const resultado = await res.json();
      setMensaje(resultado.error || resultado.detail || resultado.mensaje || "Error desconocido");
    }
    setIsSaving(false);
  };

  // Repuestos handlers
  const handleAgregarRepuesto = () => {
    setServicioActual(prev => ({ ...prev, repuestos: [...prev.repuestos, { idRepuesto: '' }] }));
  };

  // Remove repuesto from the servicio after confirmation (confirmation handled by confirmDeleteRepuesto state)
  // Note: the actual confirmation modal is rendered at the component root (see bottom of return)
  const handleEliminarRepuesto = (idx) => {
    // Open the repuesto-confirm modal for the given index
    setConfirmDeleteRepuesto({ open: true, index: idx });
  };

  const handleRepuestoChange = (idx, field, value) => {
    const updated = [...servicioActual.repuestos];
    if (field === 'idRepuesto') {
      updated[idx][field] = Number(value);
    } else {
      updated[idx][field] = value;
    }
    setServicioActual(prev => ({ ...prev, repuestos: updated }));
  };

  const getAvailableRepuestosForRow = (rowIndex) => {
    const selectedIds = servicioActual.repuestos
      .filter((_, index) => index !== rowIndex)
      .map(r => r.idRepuesto);
    return repuestos.filter(r => !selectedIds.includes(r.idRepuesto));
  };

  return (
    <div className="container-fluid main-background" style={{ minHeight: '100vh' }}>
      <div className="row flex-nowrap">
        <MenuLateral />
        <main className="col-12 col-md-10 pt-4 px-2 px-md-4 d-flex flex-column" style={{ background: 'white', borderRadius: 16, boxShadow: `0 4px 24px 0 ${colores.azul}22`, minHeight: '90vh' }}>
          <div className="card shadow-sm mb-4" style={{ border: `1.5px solid ${colores.azul}`, borderRadius: 16, background: "var(--color-beige)" }}>
            <div className="card-header d-flex justify-content-between align-items-center" style={{ background: colores.azul, color: colores.beige, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <h4 className="mb-0"><i className="bi bi-gear me-2"></i>Gestión de Servicios</h4>
              <div className="d-flex gap-2">
                <button
                  className="btn btn-dorado"
                  onClick={() => setMostrarInactivos(!mostrarInactivos)}
                >
                  {mostrarInactivos ? "Ver activos" : "Ver inactivos"}
                </button>
                <button
                  className="btn btn-azul"
                  onClick={openServicesCatalogModal}
                >
                  <i className="bi bi-journal-bookmark me-1"></i>Catálogo de servicios
                </button>
                {(canCreate && !isTecnico) && <button className="btn btn-verdeAgua" onClick={handleAgregarClick}><i className="bi bi-plus-lg"></i> Agregar servicio</button>}
              </div>
            </div>
            <div className="card-body">
              <div className="table-responsive" style={{ overflow: 'visible' }}>
                <table className="table table-striped table-hover align-middle">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descripción</th>
                      <th>Precio Base</th>
                      <th>Activo</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {servicios.map(s => (
                      <tr key={s.idServicio} style={Number(s.activo) === 0 ? { opacity: 0.5 } : {}}>
                        <td>{s.idServicio}</td>
                        <td>{s.descripcion}</td>
                        <td>${Number(s.precioBase).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</td>
                        <td>{s.activo === 1 ? "Activo" : "Inactivo"}</td>
                        <td>
                          {canView && <button className="btn btn-sm btn-verdeAgua fw-bold me-1" onClick={() => handleConsultar(s)}><i className="bi bi-search me-1"></i>Consultar</button>}
                          {s.activo === 1 && isSupervisor && (
                            <button className={`btn btn-sm fw-bold me-1 btn-dorado`} onClick={() => handleModificar(s)}><i className="bi bi-pencil-square me-1"></i>Modificar</button>
                          )}
                          {s.activo === 1 && canDeleteEffective && (
                            <button className="btn btn-sm btn-rojo fw-bold" onClick={() => handleEliminar(s.idServicio)}><i className="bi bi-trash me-1"></i>Eliminar</button>
                          )}
                          {s.activo !== 1 && canDeleteEffective && (
                            <button className="btn btn-sm btn-verdeAgua fw-bold" onClick={() => handleReactivar(s.idServicio)}><i className="bi bi-arrow-clockwise me-1"></i>Reactivar</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {servicios.length === 0 && (
                  <div className="text-center text-muted py-4">No hay servicios registrados.</div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
      {/* Modal para alta, consultar y modificar */}
      {modalVisible && (
        <div className="modal" style={{ display: "block" }}>
          <div className="modal-dialog" style={{ maxWidth: "100vw" }}>
            <div className="modal-content" style={{ width: "100vw", maxWidth: "100vw" }}>
              <div className="modal-header">
                <h5 className="modal-title fw-bold">
                  {modalModo === 'consultar'
                    ? <><i className="bi bi-search me-2"></i>Consultar servicio</>
                    : modalModo === 'modificar'
                    ? <><i className="bi bi-pencil-square me-2"></i>Modificar servicio</>
                    : <><i className="bi bi-plus-lg me-2"></i>Nuevo servicio</>}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Cerrar"
                  onClick={() => setModalVisible(false)}
                ></button>
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <form
                  className="form-container"
                  onSubmit={
                    modalModo === "modificar"
                      ? handleGuardarModificacion
                      : modalModo === "alta"
                      ? handleSubmit
                      : undefined
                  }
                >
                  <fieldset style={{ border: "none" }}>
                    <legend>
                      <i className="bi bi-gear me-2"></i>Datos del servicio
                    </legend>
                    {/* División: Información básica */}
                    <h6 className="fw-bold mt-3 mb-2 border-bottom pb-1">
                      <i className="bi bi-info-circle me-2"></i>Información básica
                    </h6>
                    <div className="row g-4">
                        <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label className="fw-semibold"><i className="bi bi-gear me-2"></i>Descripción</label>
                          <input
                            className="form-control"
                            name="descripcion"
                            value={servicioActual?.descripcion || ""}
                            onChange={handleChange}
                            required
                            disabled={modalModo === "consultar"}
                            readOnly={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                          {formErrors.descripcion && <div className="input-error-message">{formErrors.descripcion}</div>}
                        </div>
                      </div>
                      <div className="col-12 col-md-6">
                        <div className="mb-3">
                          <label className="fw-semibold"><i className="bi bi-currency-dollar me-2"></i>Precio Base</label>
                          <input
                            className="form-control"
                            name="precioBase"
                            type="number"
                            min="0"
                            step="0.01"
                            value={servicioActual?.precioBase || ""}
                            onChange={handleChange}
                            required
                            disabled={modalModo === "consultar"}
                            readOnly={modalModo === "consultar"}
                            style={{ backgroundColor: modalModo === "consultar" ? '#dee2e6' : 'white' }}
                          />
                          {formErrors.precioBase && <div className="input-error-message">{formErrors.precioBase}</div>}
                        </div>
                      </div>
                    </div>
                    {/* Repuestos asociados */}
                    <h6 className="fw-bold mt-4 mb-2 border-bottom pb-1">
                      <i className="bi bi-tools me-2"></i>Repuestos asociados
                    </h6>
                    {servicioActual.repuestos.map((r, idx) => (
                      <div key={idx} className="row g-3 align-items-end mb-3">
                        <div className="col-12 col-md-5">
                          <label>Repuesto</label>
                          <select 
                            className="form-select" 
                            value={r.idRepuesto} 
                            onChange={e => handleRepuestoChange(idx, "idRepuesto", e.target.value)} 
                            required 
                            disabled={modalModo === "consultar"}
                          >
                            <option value="">Seleccione repuesto...</option>
                            {getAvailableRepuestosForRow(idx).map(rep => <option key={rep.idRepuesto} value={rep.idRepuesto}>{rep.marca} {rep.modelo}</option>)}
                          </select>
                        </div>
                        {/* cantidad removed from modal UI; defaults to 1 */}
                        {(modalModo === "modificar" || modalModo === "alta") && (
                          <div className="col-12 col-md-3">
                            <button type="button" className="btn btn-sm btn-rojo fw-bold" onClick={() => handleEliminarRepuesto(idx)} disabled={isSalesAdmin} title={isSalesAdmin ? 'Acción no disponible para Asistente de ventas' : ''}>
                                <i className="bi bi-trash me-1"></i>Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    {(modalModo === "modificar" || modalModo === "alta") && (
                      <div className="mb-3">
                        <button type="button" className="btn btn-verdeAgua btn-sm" onClick={handleAgregarRepuesto}>
                          <i className="bi bi-plus"></i> Agregar repuesto
                        </button>
                      </div>
                    )}
                    {formErrors.repuestos && <div className="input-error-message">{formErrors.repuestos}</div>}
                    {formErrors.repuestoDetalle && <div className="input-error-message">{formErrors.repuestoDetalle}</div>}
                  </fieldset>
                  {mensaje && (
                    <div className="alert alert-danger">{mensaje}</div>
                  )}
                  {(modalModo === "modificar" || modalModo === "alta") && (
                    <div className="d-flex flex-column flex-md-row justify-content-end gap-2 mt-3">
                      <button type="submit" className="btn btn-azul fw-bold" disabled={isSaving}>
                        {isSaving ? (
                          <><i className="bi bi-arrow-repeat spinner-border spinner-border-sm me-1"></i>Guardando...</>
                        ) : (
                          <><i className="bi bi-save me-1"></i>{modalModo === "modificar" ? "Guardar cambios" : "Guardar"}</>
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-dorado fw-bold"
                        onClick={() => setModalVisible(false)}
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
      {/* Confirm modals rendered at component root to avoid duplicate/misplaced instances */}
      <ConfirmModal
        open={confirmDeleteServicio.open}
        title="Confirmar eliminación"
        message="¿Seguro que desea eliminar este servicio?"
        onCancel={confirmDeleteServicioCancel}
        onConfirm={confirmDeleteServicioConfirm}
      />
      <ConfirmModal
        open={confirmDeleteRepuesto.open}
        title="Confirmar eliminación"
        message="¿Seguro que desea eliminar este repuesto del servicio?"
        onCancel={confirmDeleteRepuestoCancel}
        onConfirm={confirmDeleteRepuestoConfirm}
      />
      {/* Modal: catálogo de servicios */}
      {servicesModalOpen && (
        <div className="modal" style={{ display: 'block' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Catálogo de servicios</h5>
                <button type="button" className="btn-close" aria-label="Cerrar" onClick={closeServicesCatalogModal}></button>
              </div>
              <div className="modal-body">
                <div className="table-responsive">
                  <table className="table table-striped table-hover align-middle">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descripción</th>
                        <th>Precio Base</th>
                        <th>Activo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviciosCatalogo.map(s => (
                        <tr key={s.idServicio}>
                          <td>{s.idServicio}</td>
                          <td>{s.descripcion}</td>
                          <td>${Number(s.precioBase).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                          <td>{s.activo === 1 ? 'Activo' : 'Inactivo'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {serviciosCatalogo.length === 0 && <div className="text-center py-3 text-muted">No hay servicios disponibles.</div>}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-dorado fw-bold" onClick={closeServicesCatalogModal}><i className="bi bi-x-circle me-1"></i>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
