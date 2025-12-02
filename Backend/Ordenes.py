from flask import Blueprint, request, jsonify, make_response, send_file
from flask_cors import cross_origin
from datetime import datetime, date
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib import colors
from reportlab.lib.units import inch
from io import BytesIO
import os
from ABMC_db import (
    alta_orden_de_reparacion, alta_orden_por_nroSerie, modificar_orden, # <--- CORRECCIÓN AQUÍ
    mostrar_ordenes, asignar_estado_orden, mostrar_estados,
    mostrar_repuestos_por_servicio, mostrar_repuestoxproveedor, mostrar_proveedores,
    alta_detalle_orden, modificar_detalle_orden, baja_detalle_orden,
    mostrar_historial_arreglos, alta_historial_arreglos, buscar_por_id
)

from datetime import timedelta
import unicodedata

def _normalize_name(s):
    if not s:
        return ''
    # remove accents, lower, remove non-alphanumeric
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = ''.join(ch for ch in s if ch.isalnum())
    return s.lower()


def encontrar_estado_id(nombre_clave):
    """Busca idEstado por una clave tentativa (p. ej. 'EnDiagnostico' o 'EnReparacion').
    Realiza comparación normalizada para tolerar espacios y acentos.
    """
    estados = mostrar_estados() or []
    clave_norm = _normalize_name(nombre_clave)
    # 1) intentar coincidencia exacta por nombre tal cual
    for e in estados:
        if getattr(e, 'nombre', None) == nombre_clave:
            return getattr(e, 'idEstado', None), getattr(e, 'nombre', None)
    # 2) intentar coincidencia normalizada
    for e in estados:
        if _normalize_name(getattr(e, 'nombre', None)) == clave_norm:
            return getattr(e, 'idEstado', None), getattr(e, 'nombre', None)
    # 3) intentar contains (clave dentro del nombre) tras normalizar
    for e in estados:
        if clave_norm and clave_norm in _normalize_name(getattr(e, 'nombre', None)):
            return getattr(e, 'idEstado', None), getattr(e, 'nombre', None)
    return None, None

bp = Blueprint('ordenes', __name__)


# Endpoint de diagnóstico (dev-only): devuelve la URL de la DB usada por SQLAlchemy y columnas de OrdenDeReparacion
@bp.route('/diagnostics/db-info', methods=['GET'])
def diagnostics_db_info():
    try:
        from BDD import database as dbmod
        engine = getattr(dbmod, 'engine', None)
        db_url = getattr(dbmod, 'DATABASE_URL', None)
        inspector = None
        cols = []
        if engine is not None:
            try:
                from sqlalchemy import inspect as _inspect
                inspector = _inspect(engine)
                col_info = inspector.get_columns('OrdenDeReparacion')
                cols = [c.get('name') for c in col_info]
            except Exception as e:
                # return partial info with error
                return jsonify({'database_url': db_url, 'columns_error': str(e), 'columns': cols}), 200

        return jsonify({'database_url': db_url, 'columns': cols}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/ordenes', methods=['POST'])
@cross_origin()
def registrar_orden():
    data = request.get_json() or {}

    nroSerie = data.get('nroSerie')
    idDispositivo = data.get('idDispositivo')

    # Necesitamos al menos nroSerie o idDispositivo
    if not nroSerie and not idDispositivo:
        return jsonify({'error': 'Se requiere nroSerie o idDispositivo'}), 400

    fecha_hoy = datetime.now().date()

    try:
        if nroSerie:
            orden = alta_orden_por_nroSerie(
                nroSerie=nroSerie,
                fecha=fecha_hoy,
                descripcionDanos=data.get('descripcionDanos'),
                diagnostico=data.get('diagnostico'),
                presupuesto=data.get('presupuesto'),
                idEmpleado=data.get('idEmpleado')
            )
            if not orden:
                return jsonify({'error': 'No se encontró dispositivo con ese número de serie'}), 404
        else:
            orden = alta_orden_de_reparacion(
                idDispositivo=idDispositivo,
                fecha=fecha_hoy,
                descripcionDanos=data.get('descripcionDanos'),
                diagnostico=data.get('diagnostico'),
                presupuesto=data.get('presupuesto'),
                idEmpleado=data.get('idEmpleado'),
                resultado=data.get('resultado'),
                informacionAdicional=data.get('informacionAdicional')
            )

        # Asignar estado inicial "EnDiagnostico" (buscando robustamente por nombre)
        id_estado_diagnostico, nombre_estado_real = encontrar_estado_id('EnDiagnostico')
        if id_estado_diagnostico:
            asignar_estado_orden(
                nroDeOrden=orden.nroDeOrden,
                idEstado=id_estado_diagnostico,
                fechaCambio=datetime.now(),
                observaciones=f"Estado inicial: {nombre_estado_real or 'En Diagnóstico'}"
            )
            # Enviar notificación por WhatsApp sobre el estado inicial (no bloqueante)
            try:
                _notify_estado_whatsapp(orden.nroDeOrden)
            except Exception:
                pass

        return jsonify({
            'nroDeOrden': orden.nroDeOrden,
            'idDispositivo': getattr(orden, 'idDispositivo', None),
            'fecha': orden.fecha.isoformat() if getattr(orden, 'fecha', None) else None,
            'descripcionDanos': getattr(orden, 'descripcionDanos', None),
            'diagnostico': getattr(orden, 'diagnostico', None),
            'presupuesto': getattr(orden, 'presupuesto', None),
            'idEmpleado': getattr(orden, 'idEmpleado', None),
            'estado': 'EnDiagnostico' if id_estado_diagnostico else None
        }), 201
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error al crear la orden: {str(e)}'}), 500
    

@bp.route('/ordenes', methods=['GET'])
@cross_origin()
def listar_ordenes():
    # `mostrar_ordenes` (o la función central) ya devuelve una lista de dicts serializados.
    ordenes = mostrar_ordenes()

    # Si el cliente envía un header X-Id-Sesion, intentamos resolver la sesión -> usuario -> empleado
    # y, si el empleado es un TÉCNICO (idCargo == 2), filtramos las órdenes para que el técnico
    # vea sólo las órdenes que tenga asignadas (idEmpleado == empleado.idEmpleado).
    try:
        id_sesion = request.headers.get('X-Id-Sesion') or request.args.get('idSesion')
        if id_sesion:
            try:
                id_sesion = int(id_sesion)
            except Exception:
                id_sesion = None
        if id_sesion:
            from ABMC_db import mostrar_sesion_por_id, obtener_empleado_por_usuario
            ses = mostrar_sesion_por_id(id_sesion)
            if ses:
                empleado = obtener_empleado_por_usuario(getattr(ses, 'idUsuario', None))
                # Si se encontró un empleado y su cargo es 2 (Técnico), filtrar
                if empleado and getattr(empleado, 'idCargo', None) == 2:
                    emp_id = getattr(empleado, 'idEmpleado', None)
                    try:
                        ordenes = [o for o in ordenes if o.get('idEmpleado') == emp_id]
                    except Exception:
                        # en caso de cualquier issue de comparación, dejar la lista original
                        pass
    except Exception:
        # No queremos que un fallo en este filtrado impida devolver las órdenes
        pass

    return jsonify(ordenes)

@bp.route('/ordenes/<int:nroDeOrden>', methods=['PUT'])
@cross_origin()
def modificar_orden_existente(nroDeOrden):
    data = request.get_json()
    if not data:
        return jsonify({"error": "No se recibieron datos"}), 400

    # Extraer los detalles del payload
    detalles_data = data.get('detalles')
    print(f"Datos recibidos para modificar orden {nroDeOrden}: {data}") # Log para depurar
    print(f"Detalles recibidos: {detalles_data}") # Log para depurar

    # ######### Control de permisos por cargo (servidor) #########
    # Permitimos que el frontend incluya el idSesion en el payload o en el header
    id_sesion = None
    try:
        # Prefer header 'X-Id-Sesion' (frontend can set this); fallback to JSON field
        id_sesion = request.headers.get('X-Id-Sesion') or data.get('idSesion')
        if id_sesion is not None:
            id_sesion = int(id_sesion)
    except Exception:
        id_sesion = None

    # Determinar idCargo del usuario que realiza la modificación
    idCargo = None
    try:
        from ABMC_db import mostrar_sesion_por_id, obtener_empleado_por_usuario
        ses = None
        if id_sesion:
            ses = mostrar_sesion_por_id(id_sesion)
        if ses:
            # ses.idUsuario -> obtener empleado para conocer idCargo
            empleado = obtener_empleado_por_usuario(ses.idUsuario)
            if empleado:
                idCargo = getattr(empleado, 'idCargo', None)
                try:
                    print(f"[Ordenes.modificar_orden_existente] ses found: idSesion={getattr(ses,'idSesion', None)}, idUsuario={getattr(ses,'idUsuario', None)}")
                    print(f"[Ordenes.modificar_orden_existente] empleado resolved: idEmpleado={getattr(empleado,'idEmpleado', None)}, idCargo={getattr(empleado,'idCargo', None)}")
                except Exception:
                    pass
    except Exception:
        # En caso de error no bloqueamos: continuamos sin idCargo (se aplicarán permisos por defecto)
        idCargo = None

    # Campos que el 'asistente de ventas' (idCargo == 3) puede modificar.
    # Por política: el asistente solo puede cambiar el dispositivo, el empleado y la descripción de daños.
    campos_iniciales = {
        'idDispositivo', 'idEmpleado', 'descripcionDanos'
    }

    # Si el usuario es asistente de ventas, filtramos los datos entrantes
    sanitized = {}
    if idCargo == 3:
        print(f"Usuario con idCargo=3 (asistente de ventas) intenta modificar orden {nroDeOrden}. Filtrando campos...")
        for k in campos_iniciales:
            if k in data:
                sanitized[k] = data.get(k)
        # Ignorar explícitamente cualquier intento de modificar detalles u otros campos
        if 'detalles' in data:
            print(f"Asistente intentó modificar 'detalles' en orden {nroDeOrden} — campo ignorado.")
    else:
        # Para otros cargos aceptamos todos los campos explícitos usados por modificar_orden
        sanitized = {
            'idDispositivo': data.get('idDispositivo'),
            'fecha': data.get('fecha'),
            'descripcionDanos': data.get('descripcionDanos'),
            'diagnostico': data.get('diagnostico'),
            'presupuesto': data.get('presupuesto'),
            'idEmpleado': data.get('idEmpleado'),
            'resultado': data.get('resultado'),
            'informacionAdicional': data.get('informacionAdicional'),
            'detalles': detalles_data
        }

    # Preparar los argumentos para modificar_orden, convirtiendo formatos si es necesario
    fecha_arg = None
    if sanitized.get('fecha'):
        try:
            fecha_arg = datetime.strptime(sanitized.get('fecha'), '%Y-%m-%d').date()
        except Exception:
            # Si la fecha no coincide con el formato esperado, ignorarla (la función DB podrá manejar None)
            fecha_arg = None

    # Debug: log sanitized payload and idCargo before calling modificar_orden
    try:
        print(f"[Ordenes.modificar_orden_existente] idCargo={idCargo}, sanitized keys={list(sanitized.keys())}")
        print(f"[Ordenes.modificar_orden_existente] diagnostico in sanitized? {'diagnostico' in sanitized}")
        print(f"[Ordenes.modificar_orden_existente] detalles in sanitized? {'detalles' in sanitized}")
    except Exception:
        pass

    resultado = modificar_orden(
        nroDeOrden=nroDeOrden,
        idDispositivo=sanitized.get('idDispositivo'),
        fecha=fecha_arg,
        descripcionDanos=sanitized.get('descripcionDanos'),
        diagnostico=sanitized.get('diagnostico'),
        presupuesto=sanitized.get('presupuesto'),
        idEmpleado=sanitized.get('idEmpleado'),
        resultado=sanitized.get('resultado'),
        informacionAdicional=sanitized.get('informacionAdicional'),
        detalles=sanitized.get('detalles')  # <-- Pasar la lista de detalles si está permitida
    )

    if "error" in resultado:
        return jsonify(resultado), 500
    return jsonify(resultado), 200


@bp.route('/ordenes/<int:nroDeOrden>', methods=['GET'])
@cross_origin()
def obtener_orden_detalle(nroDeOrden):
    ordenes = mostrar_ordenes()  # mostrar_ordenes delega a obtener_ordenes
    # Try to get detail mode via helper directly if available
    try:
        from ABMC_db import obtener_ordenes
        detalle = obtener_ordenes(mode='detail', nroDeOrden=nroDeOrden)
        if not detalle:
            return jsonify({'error': 'Orden no encontrada'}), 404
        return jsonify(detalle[0]), 200
    except Exception:
        # Fallback: buscar en la lista genérica
        ord_list = [o for o in ordenes if o.get('nroDeOrden') == nroDeOrden]
        if not ord_list:
            return jsonify({'error': 'Orden no encontrada'}), 404
        return jsonify(ord_list[0]), 200


@bp.route('/ordenes/<int:nroDeOrden>/detalles', methods=['GET'])
@cross_origin()
def obtener_detalles_orden(nroDeOrden):
    """Endpoint para devolver solo los detalles de una orden.

    El frontend solicita `/ordenes/<nro>/detalles` en varios puntos; este
    endpoint devuelve una lista (posible vacía) con los detalles serializados.
    """
    try:
        from ABMC_db import obtener_ordenes
        ordenes = obtener_ordenes(mode='detail', nroDeOrden=nroDeOrden)
        if not ordenes:
            # devolver array vacío para que el frontend maneje el caso
            return jsonify([]), 200
        detalles = ordenes[0].get('detalles', []) or []
        return jsonify(detalles), 200
    except Exception as e:
        # En caso de error devolver 500 con mensaje para facilitar debugging
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error al obtener detalles: {str(e)}'}), 500


# Nuevo endpoint: repuestos + proveedores por servicio
@bp.route('/ordenes/servicios/<idServicio>/repuestos', methods=['GET'])
@cross_origin()
def api_repuestos_por_servicio(idServicio):
    try:
        idServicio = int(idServicio)
    except ValueError:
        return jsonify({'error': 'idServicio debe ser un entero'}), 400

    repuestos = mostrar_repuestos_por_servicio(idServicio) or []
    relaciones = mostrar_repuestoxproveedor() or []
    proveedores = mostrar_proveedores() or []

    resultado = []
    for r in repuestos:
        provs = []
        for rel in relaciones:
            try:
                rel_id_repuesto = getattr(rel, 'idRepuesto', None)
                rel_id_proveedor = getattr(rel, 'idProveedor', None)
                if rel_id_repuesto == r.get('idRepuesto') or str(rel_id_repuesto) == str(r.get('idRepuesto')):
                    prov_obj = next((p for p in proveedores if getattr(p, 'idProveedor', None) == rel_id_proveedor), None)
                    if prov_obj:
                        provs.append({
                            'idProveedor': getattr(prov_obj, 'idProveedor', None),
                            'cuilProveedor': getattr(prov_obj, 'cuil', None) or getattr(prov_obj, 'cuilProveedor', None),
                            'razonSocial': getattr(prov_obj, 'razonSocial', None),
                            'costo': getattr(rel, 'costo', None)
                        })
            except Exception:
                continue
        resultado.append({
            'idRepuesto': r.get('idRepuesto'),
            'marca': r.get('marca'),
            'modelo': r.get('modelo'),
            'descripcion': f"{r.get('marca','')} {r.get('modelo','')}".strip(),
            'proveedores': provs
        })
    return jsonify(resultado)
    return jsonify({'success': True})

@bp.route('/ordenes/<int:nroDeOrden>/confirmacion-presupuesto', methods=['POST'])
def confirmar_presupuesto(nroDeOrden):
    data = request.json
    if 'aceptado' not in data:
        return jsonify({'error': 'Campo "aceptado" requerido'}), 400
    aceptado = bool(data['aceptado'])
    usuario = data.get('usuario', 'SinUsuario')
    fecha = datetime.now()

    # Buscar ids robustamente
    id_en_reparacion, nombre_reparacion = encontrar_estado_id('EnReparacion')
    id_desestimada, nombre_desestimada = encontrar_estado_id('Desestimada')
    nuevo_estado = id_en_reparacion if aceptado else id_desestimada
    if not nuevo_estado:
        return jsonify({'error': 'Estados no configurados correctamente'}), 500

    historial = asignar_estado_orden(
        nroDeOrden=nroDeOrden,
        idEstado=nuevo_estado,
        fechaCambio=fecha,
        observaciones=f"Presupuesto {'aceptado' if aceptado else 'rechazado'} por {usuario} en {fecha.strftime('%Y-%m-%d %H:%M')}"
    )

    # Intentar notificar por WhatsApp sobre el cambio de estado (no bloqueante)
    try:
        _notify_estado_whatsapp(nroDeOrden)
    except Exception:
        pass

    return jsonify({'success': True, 'nuevoEstado': nombre_reparacion if aceptado else nombre_desestimada})

@bp.route('/ordenes/<int:nroDeOrden>/actualizaciones', methods=['POST'])
@cross_origin()
def registrar_actualizacion_orden(nroDeOrden):
    """
    Registra un avance técnico en la orden.
    Request JSON: { "descripcion": "...", "usuario": "nombre" }
    """
    from BDD.database import OrdenDeReparacion
    
    data = request.json
    descripcion = data.get('descripcion')
    usuario = data.get('usuario', 'SinUsuario')
    fechaArreglo = datetime.now()

    if not descripcion:
        return jsonify({'error': 'Campo descripción requerido'}), 400

    # Corregir pasando la clase en lugar del string
    orden = buscar_por_id(OrdenDeReparacion, nroDeOrden)
    if not orden:
        return jsonify({'error': 'Orden no encontrada'}), 404
    # Debug: log raw descripcion recibida (temporal)
    try:
        print(f"[Ordenes.py] registrar_actualizacion_orden - recibido descripcion: {descripcion!r}")
    except Exception:
        pass

    # Limpieza defensiva: si por alguna razón el frontend ya incluyó
    # "(Registrado por ... en ...)" al final de la descripción, lo removemos
    # para almacenar sólo el texto ingresado.
    try:
        import re
        descripcion_limpia = re.sub(r"\s*\(?\s*Registrado por[^)\n]*\)?\s*$", '', descripcion, flags=re.IGNORECASE)
        descripcion_limpia = descripcion_limpia.strip()
    except Exception:
        descripcion_limpia = descripcion

    try:
        print(f"[Ordenes.py] registrar_actualizacion_orden - descripcion limpia: {descripcion_limpia!r}")
    except Exception:
        pass

    historial = alta_historial_arreglos(
        nroDeOrden=nroDeOrden,
        idDispositivo=orden.idDispositivo,
        fechaArreglo=fechaArreglo,
        descripcion=descripcion_limpia
    )

    return jsonify({'success': True})

@bp.route('/ordenes/<int:nroDeOrden>/actualizaciones', methods=['GET'])
@cross_origin()
def listar_actualizaciones_orden(nroDeOrden):
    """
    Devuelve el historial de actualizaciones técnicas de una orden.
    """
    historial = mostrar_historial_arreglos(nroDeOrden)
    result = []
    for h in historial:
        result.append({
            'idHistorialor': h.idHistorialor,
            'fechaArreglo': h.fechaArreglo.isoformat(),
            'descripcion': h.descripcion,
        })
    return jsonify(result)


@bp.route('/ordenes/<int:nroDeOrden>/solicitar-aprobacion', methods=['POST', 'OPTIONS'])
@cross_origin()
def solicitar_aprobacion(nroDeOrden):
    """
    Marca la orden como 'PendienteDeAprobacion' añadiendo un registro en HistorialEstadoOrden.
    """
    # Responder inmediatamente a preflight OPTIONS para satisfacer CORS
    if request.method == 'OPTIONS':
        return make_response('', 200)
    try:
        id_pendiente, nombre_pendiente = encontrar_estado_id('PendienteDeAprobacion')
        if not id_pendiente:
            return jsonify({'error': 'Estado PendienteDeAprobacion no configurado en la BD'}), 500

        historial = asignar_estado_orden(
            nroDeOrden=nroDeOrden,
            idEstado=id_pendiente,
            fechaCambio=datetime.now(),
            observaciones=f'Solicitado para aprobación'
        )
        # Notificar por WhatsApp (no bloqueante)
        try:
            _notify_estado_whatsapp(nroDeOrden)
        except Exception:
            pass

        return jsonify({'success': True, 'estado': nombre_pendiente}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/ordenes/<int:nroDeOrden>/presupuesto/aceptar', methods=['POST', 'OPTIONS'])
@cross_origin()
def presupuesto_aceptar(nroDeOrden):
    """
    Marca la orden como 'EnReparacion' cuando se acepta el presupuesto.
    """
    # Responder inmediatamente a preflight OPTIONS para satisfacer CORS
    if request.method == 'OPTIONS':
        return make_response('', 200)
    try:
        id_en_reparacion, nombre = encontrar_estado_id('EnReparacion')
        if not id_en_reparacion:
            return jsonify({'error': 'Estado EnReparacion no configurado en la BD'}), 500

        historial = asignar_estado_orden(
            nroDeOrden=nroDeOrden,
            idEstado=id_en_reparacion,
            fechaCambio=datetime.now(),
            observaciones='Presupuesto aceptado por Administrador de Ventas'
        )
        # Notificar por WhatsApp (no bloqueante)
        try:
            _notify_estado_whatsapp(nroDeOrden)
        except Exception:
            pass

        return jsonify({'success': True, 'estado': nombre}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/ordenes/<int:nroDeOrden>/presupuesto/rechazar', methods=['POST', 'OPTIONS'])
@cross_origin()
def presupuesto_rechazar(nroDeOrden):
    """
    Marca la orden como 'PendienteDeRetiro' cuando se rechaza el presupuesto.
    """
    # Responder inmediatamente a preflight OPTIONS para satisfacer CORS
    if request.method == 'OPTIONS':
        return make_response('', 200)
    try:
        id_retiro, nombre = encontrar_estado_id('PendienteDeRetiro')
        if not id_retiro:
            return jsonify({'error': 'Estado PendienteDeRetiro no configurado en la BD'}), 500

        # Además de asignar el estado, registrar el resultado y la fechaInicioRetiro
        try:
            from ABMC_db import modificar_orden
            fecha_hoy = datetime.now().date()
            # Establecer resultado='desestimada' y fechaInicioRetiro
            modificar_orden(
                nroDeOrden=nroDeOrden,
                resultado='desestimada',
                fechaInicioRetiro=fecha_hoy
            )
        except Exception:
            # No romper la operación principal si falla la actualización secundaria
            import traceback
            traceback.print_exc()

        historial = asignar_estado_orden(
            nroDeOrden=nroDeOrden,
            idEstado=id_retiro,
            fechaCambio=datetime.now(),
            observaciones='Presupuesto rechazado por Administrador de Ventas'
        )
        # Notificar por WhatsApp (no bloqueante)
        try:
            _notify_estado_whatsapp(nroDeOrden)
        except Exception:
            pass

        return jsonify({'success': True, 'estado': nombre}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/ordenes/<int:nroDeOrden>/marcar-retirada', methods=['POST', 'OPTIONS'])
@cross_origin()
def marcar_retirada(nroDeOrden):
    """
    Marca la orden directamente como 'Retirada'.
    Body (JSON) opcional: { "usuario": "nombre" }
    """
    # Responder preflight
    if request.method == 'OPTIONS':
        return make_response('', 200)

    data = request.get_json() or {}
    usuario = data.get('usuario', 'SinUsuario')

    try:
        id_retirada, nombre = encontrar_estado_id('Retirada')
        if not id_retirada:
            return jsonify({'error': 'Estado Retirada no configurado en la BD'}), 500

        # Intentar establecer fechaInicioRetiro en la orden (si la función está disponible)
        try:
            from ABMC_db import modificar_orden
            fecha_hoy = datetime.now().date()
            modificar_orden(nroDeOrden=nroDeOrden, fechaInicioRetiro=fecha_hoy)
        except Exception:
            # No interrumpir si falla la actualización secundaria
            import traceback
            traceback.print_exc()

        historial = asignar_estado_orden(
            nroDeOrden=nroDeOrden,
            idEstado=id_retirada,
            fechaCambio=datetime.now(),
            observaciones=f'Marcada como retirada por {usuario}'
        )
        # Notificar por WhatsApp (no bloqueante)
        try:
            _notify_estado_whatsapp(nroDeOrden)
        except Exception:
            pass

        return jsonify({'success': True, 'estado': nombre}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/ordenes/mark-abandoned', methods=['POST', 'OPTIONS'])
@cross_origin()
def api_mark_abandoned():
    """
    Endpoint para marcar órdenes como 'Abandonada' cuando su fechaInicioRetiro
    tiene al menos `days` días de antigüedad (por defecto 30).
    Request JSON opcional: { "days": 30 }
    Responde JSON: { success: true, changed: <n> }
    """
    # Responder preflight
    if request.method == 'OPTIONS':
        return make_response('', 200)
    try:
        data = request.get_json() or {}
        try:
            days = int(data.get('days', 30))
        except Exception:
            days = 30

        threshold = datetime.now().date() - timedelta(days=days)

        # Buscar id de estado 'Abandonada' usando el helper local (robusto)
        id_aband, nombre_aband = encontrar_estado_id('Abandonada')
        if not id_aband:
            # intentar búsqueda más laxa: contains 'abandon'
            # (encontrar_estado_id ya hace contains; si no hay, devolvemos error)
            return jsonify({'error': 'Estado "Abandonada" no encontrado en la tabla Estados'}), 500

        from ABMC_db import session_scope, asignar_estado_orden
        from BDD.database import OrdenDeReparacion, HistorialEstadoOrden

        changed = 0
        marked = []
        from ABMC_db import obtener_ordenes

        with session_scope() as s:
            ords = s.query(OrdenDeReparacion).filter(OrdenDeReparacion.fechaInicioRetiro != None).filter(OrdenDeReparacion.fechaInicioRetiro <= threshold).all()
            for o in ords:
                nro = getattr(o, 'nroDeOrden', None)
                if nro is None:
                    continue
                existe = s.query(HistorialEstadoOrden).filter(HistorialEstadoOrden.nroDeOrden == nro).filter(HistorialEstadoOrden.idEstado == id_aband).first()
                if existe:
                    continue
                try:
                    # usar la función central para registrar historial (maneja side-effects)
                    asignar_estado_orden(nroDeOrden=nro, idEstado=id_aband, fechaCambio=datetime.now(), observaciones='Marcada automáticamente como Abandonada por tiempo de retiro excedido')
                    changed += 1
                    # obtener representación detallada de la orden para devolver al frontend
                    try:
                        detalles = obtener_ordenes(mode='detail', nroDeOrden=nro)
                        if detalles and len(detalles) > 0:
                            marked.append(detalles[0])
                        else:
                            marked.append({'nroDeOrden': nro})
                    except Exception:
                        # fallback mínimo
                        marked.append({'nroDeOrden': nro})
                except Exception:
                    import traceback
                    traceback.print_exc()
                    continue

        return jsonify({'success': True, 'changed': changed, 'marked': marked}), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@bp.route('/ordenes/<int:nroDeOrden>/pdf', methods=['GET'])
@cross_origin()
def generar_pdf_orden(nroDeOrden):
    """
    Genera un PDF con los detalles de la orden de reparación.
    """
    try:
        from ABMC_db import obtener_ordenes
        ordenes = obtener_ordenes(mode='detail', nroDeOrden=nroDeOrden)
        if not ordenes:
            return jsonify({'error': 'Orden no encontrada'}), 404
        
        orden = ordenes[0]
        
        # Crear buffer para el PDF
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, 
                              rightMargin=36, leftMargin=36,
                              topMargin=36, bottomMargin=36)
        
        styles = getSampleStyleSheet()
        
        # Estilos personalizados
        title_style = ParagraphStyle(
            'Title',
            parent=styles['Heading1'],
            fontSize=16,
            spaceAfter=15,
            alignment=1,
            fontName='Helvetica-Bold'
        )
        
        company_style = ParagraphStyle(
            'Company',
            parent=styles['Normal'],
            fontSize=10,
            alignment=1,
            fontName='Helvetica-Bold'
        )
        
        section_style = ParagraphStyle(
            'Section',
            parent=styles['Heading2'],
            fontSize=11,
            spaceAfter=8,
            fontName='Helvetica-Bold',
            textColor=colors.black
        )
        
        normal_style = styles['Normal']
        normal_style.fontSize = 9
        
        small_style = ParagraphStyle(
            'Small',
            parent=styles['Normal'],
            fontSize=8,
            textColor=colors.gray
        )
        
        # Contenido del PDF
        elements = []
        
        # Encabezado con logo y datos de empresa
        header_table = Table([
            [Image(os.path.join(os.path.dirname(__file__), 'static', 'logo.png'), 1.5*inch, 0.8*inch) if os.path.exists(os.path.join(os.path.dirname(__file__), 'static', 'logo.png')) else '',
             [
                 Paragraph("REPARAPP", company_style),
                 Paragraph("Servicio Técnico Especializado", ParagraphStyle('Sub', parent=company_style, fontSize=8)),
                 Paragraph("Calle Ficticia 123, Ciudad - Tel: +54 11 1234-5678", small_style),
                 Paragraph("Email: info@reparapp.com", small_style)
             ]]
        ], colWidths=[1.5*inch, 4*inch])
        
        header_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 15))
        
        # Línea divisoria
        elements.append(Table([['']], colWidths=[7.5*inch], rowHeights=[1]))
        elements.append(Spacer(1, 10))
        
        # Título principal
        elements.append(Paragraph("ORDEN DE REPARACIÓN", title_style))
        elements.append(Spacer(1, 10))
        
        # Información de la orden en 2 columnas
        order_info = [
            ['N° Orden:', str(orden.get('nroDeOrden', '')), 'Fecha:', orden.get('fecha', '')],
            ['Estado:', orden.get('estado', '') or 'Pendiente', 'Técnico:', orden.get('empleado_info', 'No asignado')]
        ]
        
        order_table = Table(order_info, colWidths=[1*inch, 1.5*inch, 1*inch, 1.5*inch])
        order_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ('BACKGROUND', (0, 0), (-1, -1), colors.lightgrey),
        ]))
        elements.append(order_table)
        elements.append(Spacer(1, 15))
        
        # Información del cliente y dispositivo en 2 columnas
        # Construir bloque de cliente con campos separados si están disponibles
        cliente_text_lines = []
        cliente = orden.get('cliente') if isinstance(orden.get('cliente'), dict) else None
        # Si la estructura viene bajo dispositivo.cliente
        if not cliente and isinstance(orden.get('dispositivo'), dict):
            cliente = orden.get('dispositivo', {}).get('cliente') if isinstance(orden.get('dispositivo', {}).get('cliente'), dict) else None

        if cliente:
            nombre = cliente.get('nombre') or ''
            apellido = cliente.get('apellido') or ''
            if nombre or apellido:
                cliente_text_lines.append(f"Nombre: {nombre} {apellido}".strip())
            nro_doc = cliente.get('numeroDoc') or cliente.get('dni') or cliente.get('documento')
            if nro_doc:
                cliente_text_lines.append(f"Documento: {nro_doc}")
            telefono = cliente.get('telefono') or cliente.get('telefonoCelular') or cliente.get('telefonoContacto')
            if telefono:
                cliente_text_lines.append(f"Tel: {telefono}")
            email = cliente.get('email') or cliente.get('mail')
            if email:
                cliente_text_lines.append(f"Email: {email}")
            direccion = cliente.get('direccion') or cliente.get('domicilio') or cliente.get('direccionFiscal')
            if direccion:
                cliente_text_lines.append(f"Domicilio: {direccion}")
        else:
            # Fallback a cliente_info string si existe
            if orden.get('cliente_info'):
                cliente_text_lines.append(orden.get('cliente_info'))
            else:
                cliente_text_lines.append('No disponible')

        cliente_block_text = '<br/>'.join(cliente_text_lines)

        client_device_info = [
            [
                Paragraph("<b>CLIENTE</b><br/>" + cliente_block_text, normal_style),
                Paragraph("<b>DISPOSITIVO</b><br/>" + (orden.get('dispositivo_info', 'No disponible')), normal_style)
            ]
        ]
        
        client_device_table = Table(client_device_info, colWidths=[3.5*inch, 3.5*inch])
        client_device_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, colors.black),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(client_device_table)
        elements.append(Spacer(1, 15))
        
        # Descripción de daños y diagnóstico en 2 columnas
        description_diagnosis = [
            [
                Paragraph("<b>DESCRIPCIÓN DE DAÑOS</b><br/>" + (orden.get('descripcionDanos', 'No especificado')), normal_style),
                Paragraph("<b>DIAGNÓSTICO</b><br/>" + (orden.get('diagnostico', 'Pendiente')), normal_style)
            ]
        ]
        
        desc_diag_table = Table(description_diagnosis, colWidths=[3.5*inch, 3.5*inch])
        desc_diag_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 1, colors.black),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.gray),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(desc_diag_table)
        elements.append(Spacer(1, 15))
        
        # Detalles de reparación
        detalles = orden.get('detalles', [])
        if detalles:
            elements.append(Paragraph("DETALLES DE LA REPARACIÓN", section_style))
            
            data_detalles = [['Servicio', 'Repuesto', 'Costo Serv.', 'Costo Rep.', 'Subtotal']]
            
            for det in detalles:
                servicio_desc = str(det.get('servicioDescripcion', '')) or ''
                servicio = servicio_desc[:25] + '...' if len(servicio_desc) > 25 else servicio_desc
                
                repuesto_desc = str(det.get('repuestoDescripcion', '')) or ''
                repuesto = repuesto_desc[:25] + '...' if len(repuesto_desc) > 25 else repuesto_desc
                
                costo_serv = f"${det.get('costoServicio', 0):.2f}"
                costo_rep = f"${det.get('costoRepuesto', 0):.2f}"
                subtotal = f"${det.get('subtotal', 0):.2f}"
                data_detalles.append([servicio, repuesto, costo_serv, costo_rep, subtotal])
            
            table_detalles = Table(data_detalles, colWidths=[1.5*inch, 1.5*inch, 0.8*inch, 0.8*inch, 0.9*inch])
            table_detalles.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.gray),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
                ('ALIGN', (2, 1), (4, -1), 'RIGHT'),
            ]))
            elements.append(table_detalles)
            elements.append(Spacer(1, 10))
        
        # Total
        precio_total = orden.get('precioTotal', 0)
        total_table = Table([['TOTAL: $' + f"{precio_total:.2f}"]], colWidths=[7.5*inch])
        total_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), colors.black),
            ('TEXTCOLOR', (0, 0), (0, 0), colors.white),
            ('ALIGN', (0, 0), (0, 0), 'CENTER'),
            ('FONTNAME', (0, 0), (0, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (0, 0), 12),
            ('BOTTOMPADDING', (0, 0), (0, 0), 8),
        ]))
        elements.append(total_table)
        elements.append(Spacer(1, 20))
        
        # Pie de página
        footer_table = Table([
            [
                Paragraph("Gracias por confiar en nuestros servicios técnicos especializados.", small_style),
                Paragraph(f"Fecha de emisión: {datetime.now().strftime('%d/%m/%Y %H:%M')}<br/>Comprobante generado electrónicamente", small_style)
            ]
        ], colWidths=[3.5*inch, 3.5*inch])
        
        footer_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        elements.append(footer_table)
        
        # Disclaimer de responsabilidad
        elements.append(Spacer(1, 12))
        disclaimer_style = ParagraphStyle(
            'Disclaimer',
            parent=styles['Normal'],
            fontSize=7,
            textColor=colors.HexColor('#333333'),
            alignment=4,  # Justified
            leading=9,
            leftIndent=10,
            rightIndent=10
        )
        disclaimer_text = (
            "<b>IMPORTANTE:</b> Para retirar el producto deberá presentarse este comprobante. "
            "Transcurrido 30 días de la fecha de la presente facturaremos por almacenaje y el precio de la reparación "
            "será actualizado según la lista de precios vigentes. Si el producto no fuera retirado dentro del plazo "
            "de 60 días de la fecha de la presente será considerado abandonado en los términos de los artículos 2525 y 2526 "
            "del Código Civil, quedando facultados a darle el destino que consideremos pertinente."
        )
        elements.append(Paragraph(disclaimer_text, disclaimer_style))
        
        # Generar PDF
        doc.build(elements)
        buffer.seek(0)
        
        # Preparar respuesta SIN attachment para que se pueda visualizar
        response = make_response(buffer.getvalue())
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = f'inline; filename=orden_reparacion_{nroDeOrden}.pdf'
        
        return response
        
    except Exception as e:
        return jsonify({'error': f'Error al generar PDF: {str(e)}'}), 500


def _build_pdf_bytes(nroDeOrden):
    """
    Helper: genera el PDF en memoria y devuelve bytes.
    Se reutiliza la misma lógica que en `generar_pdf_orden` pero devuelve bytes
    para poder subir o enviar el archivo sin duplicar demasiado código.
    """
    from ABMC_db import obtener_ordenes
    ordenes = obtener_ordenes(mode='detail', nroDeOrden=nroDeOrden)
    if not ordenes:
        raise FileNotFoundError('Orden no encontrada')

    orden = ordenes[0]
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter,
                          rightMargin=36, leftMargin=36,
                          topMargin=36, bottomMargin=36)
    styles = getSampleStyleSheet()

    # Recreate the rich PDF layout from generar_pdf_orden but return bytes
    title_style = ParagraphStyle(
        'Title',
        parent=styles['Heading1'],
        fontSize=16,
        spaceAfter=15,
        alignment=1,
        fontName='Helvetica-Bold'
    )
    company_style = ParagraphStyle(
        'Company',
        parent=styles['Normal'],
        fontSize=10,
        alignment=1,
        fontName='Helvetica-Bold'
    )
    section_style = ParagraphStyle(
        'Section',
        parent=styles['Heading2'],
        fontSize=11,
        spaceAfter=8,
        fontName='Helvetica-Bold',
        textColor=colors.black
    )
    normal_style = styles['Normal']
    normal_style.fontSize = 9
    small_style = ParagraphStyle(
        'Small',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.gray
    )

    elements = []

    # Header with logo and company info
    logo_path = os.path.join(os.path.dirname(__file__), 'static', 'logo.png')
    logo_img = Image(logo_path, 1.5*inch, 0.8*inch) if os.path.exists(logo_path) else ''
    header_table = Table([
        [logo_img,
         [
             Paragraph("REPARAPP", company_style),
             Paragraph("Servicio Técnico Especializado", ParagraphStyle('Sub', parent=company_style, fontSize=8)),
             Paragraph("Calle Ficticia 123, Ciudad - Tel: +54 11 1234-5678", small_style),
             Paragraph("Email: info@reparapp.com", small_style)
         ]]
    ], colWidths=[1.5*inch, 4*inch])
    header_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (0, 0), 'LEFT'),
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 15))
    elements.append(Table([['']], colWidths=[7.5*inch], rowHeights=[1]))
    elements.append(Spacer(1, 10))
    elements.append(Paragraph("ORDEN DE REPARACIÓN", title_style))
    elements.append(Spacer(1, 10))

    order_info = [
        ['N° Orden:', str(orden.get('nroDeOrden', '')), 'Fecha:', orden.get('fecha', '')],
        ['Estado:', orden.get('estado', '') or 'Pendiente', 'Técnico:', orden.get('empleado_info', 'No asignado')]
    ]
    order_table = Table(order_info, colWidths=[1*inch, 1.5*inch, 1*inch, 1.5*inch])
    order_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('BACKGROUND', (0, 0), (-1, -1), colors.lightgrey),
    ]))
    elements.append(order_table)
    elements.append(Spacer(1, 15))

    # Cliente y dispositivo
    cliente_text_lines = []
    cliente = orden.get('cliente') if isinstance(orden.get('cliente'), dict) else None
    if not cliente and isinstance(orden.get('dispositivo'), dict):
        cliente = orden.get('dispositivo', {}).get('cliente') if isinstance(orden.get('dispositivo', {}).get('cliente'), dict) else None

    if cliente:
        nombre = cliente.get('nombre') or ''
        apellido = cliente.get('apellido') or ''
        if nombre or apellido:
            cliente_text_lines.append(f"Nombre: {nombre} {apellido}".strip())
        nro_doc = cliente.get('numeroDoc') or cliente.get('dni') or cliente.get('documento')
        if nro_doc:
            cliente_text_lines.append(f"Documento: {nro_doc}")
        telefono = cliente.get('telefono') or cliente.get('telefonoCelular') or cliente.get('telefonoContacto')
        if telefono:
            cliente_text_lines.append(f"Tel: {telefono}")
        email = cliente.get('email') or cliente.get('mail')
        if email:
            cliente_text_lines.append(f"Email: {email}")
        direccion = cliente.get('direccion') or cliente.get('domicilio') or cliente.get('direccionFiscal')
        if direccion:
            cliente_text_lines.append(f"Domicilio: {direccion}")
    else:
        if orden.get('cliente_info'):
            cliente_text_lines.append(orden.get('cliente_info'))
        else:
            cliente_text_lines.append('No disponible')

    cliente_block_text = '<br/>'.join(cliente_text_lines)
    client_device_info = [
        [
            Paragraph("<b>CLIENTE</b><br/>" + cliente_block_text, normal_style),
            Paragraph("<b>DISPOSITIVO</b><br/>" + (orden.get('dispositivo_info', 'No disponible')), normal_style)
        ]
    ]
    client_device_table = Table(client_device_info, colWidths=[3.5*inch, 3.5*inch])
    client_device_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(client_device_table)
    elements.append(Spacer(1, 15))

    # Descripción y diagnóstico
    description_diagnosis = [
        [
            Paragraph("<b>DESCRIPCIÓN DE DAÑOS</b><br/>" + (orden.get('descripcionDanos', 'No especificado')), normal_style),
            Paragraph("<b>DIAGNÓSTICO</b><br/>" + (orden.get('diagnostico', 'Pendiente')), normal_style)
        ]
    ]
    desc_diag_table = Table(description_diagnosis, colWidths=[3.5*inch, 3.5*inch])
    desc_diag_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 1, colors.black),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.gray),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(desc_diag_table)
    elements.append(Spacer(1, 15))

    detalles = orden.get('detalles', [])
    if detalles:
        elements.append(Paragraph("DETALLES DE LA REPARACIÓN", section_style))
        data_detalles = [['Servicio', 'Repuesto', 'Costo Serv.', 'Costo Rep.', 'Subtotal']]
        for det in detalles:
            servicio_desc = str(det.get('servicioDescripcion', '')) or ''
            servicio = servicio_desc[:25] + '...' if len(servicio_desc) > 25 else servicio_desc
            repuesto_desc = str(det.get('repuestoDescripcion', '')) or ''
            repuesto = repuesto_desc[:25] + '...' if len(repuesto_desc) > 25 else repuesto_desc
            costo_serv = f"${det.get('costoServicio', 0):.2f}"
            costo_rep = f"${det.get('costoRepuesto', 0):.2f}"
            subtotal = f"${det.get('subtotal', 0):.2f}"
            data_detalles.append([servicio, repuesto, costo_serv, costo_rep, subtotal])
        table_detalles = Table(data_detalles, colWidths=[1.5*inch, 1.5*inch, 0.8*inch, 0.8*inch, 0.9*inch])
        table_detalles.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.gray),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
            ('ALIGN', (2, 1), (4, -1), 'RIGHT'),
        ]))
        elements.append(table_detalles)
        elements.append(Spacer(1, 10))

    precio_total = orden.get('precioTotal', 0)
    total_table = Table([['TOTAL: $' + f"{precio_total:.2f}"]], colWidths=[7.5*inch])
    total_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.black),
        ('TEXTCOLOR', (0, 0), (0, 0), colors.white),
        ('ALIGN', (0, 0), (0, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (0, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (0, 0), 12),
        ('BOTTOMPADDING', (0, 0), (0, 0), 8),
    ]))
    elements.append(total_table)
    elements.append(Spacer(1, 20))

    footer_table = Table([
        [
            Paragraph("Gracias por confiar en nuestros servicios técnicos especializados.", small_style),
            Paragraph(f"Fecha de emisión: {datetime.now().strftime('%d/%m/%Y %H:%M')}<br/>Comprobante generado electrónicamente", small_style)
        ]
    ], colWidths=[3.5*inch, 3.5*inch])
    footer_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (0, 0), 'LEFT'),
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(footer_table)

    # Disclaimer de responsabilidad
    elements.append(Spacer(1, 12))
    disclaimer_style = ParagraphStyle(
        'Disclaimer',
        parent=styles['Normal'],
        fontSize=7,
        textColor=colors.HexColor('#333333'),
        alignment=4,  # Justified
        leading=9,
        leftIndent=10,
        rightIndent=10
    )
    disclaimer_text = (
        "<b>IMPORTANTE:</b> Para retirar el producto deberá presentarse este comprobante. "
        "Transcurrido 30 días de la fecha de la presente facturaremos por almacenaje y el precio de la reparación "
        "será actualizado según la lista de precios vigentes. Si el producto no fuera retirado dentro del plazo "
        "de 60 días de la fecha de la presente será considerado abandonado en los términos de los artículos 2525 y 2526 "
        "del Código Civil, quedando facultados a darle el destino que consideremos pertinente."
    )
    elements.append(Paragraph(disclaimer_text, disclaimer_style))

    # Build PDF and return bytes
    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()


def _notify_estado_whatsapp(nroDeOrden):
    """
    Helper: envía un mensaje de texto por WhatsApp notificando el último estado de la orden.
    No debe bloquear la operación principal: captura excepciones y devuelve True/False.
    """
    try:
        from ABMC_db import obtener_ordenes
        from whatsapp import send_text
        ordenes = obtener_ordenes(mode='detail', nroDeOrden=nroDeOrden)
        if not ordenes:
            return False
        orden = ordenes[0]

        # Determinar número de destinatario desde cliente o dispositivo.cliente
        cliente = orden.get('cliente') if isinstance(orden.get('cliente'), dict) else None
        if not cliente and isinstance(orden.get('dispositivo'), dict):
            cliente = orden.get('dispositivo', {}).get('cliente') if isinstance(orden.get('dispositivo', {}).get('cliente'), dict) else None

        destinatario = None
        if cliente:
            destinatario = cliente.get('telefono') or cliente.get('telefonoCelular') or cliente.get('telefonoContacto') or cliente.get('telefono_fijo')

        if not destinatario:
            # No hay teléfono conocido, salir silenciosamente
            return False

        # Normalizar solo dígitos
        import re
        numero = re.sub(r'\D', '', str(destinatario or ''))
        if not numero:
            return False

        # Determinar el nombre del último estado guardado en la orden
        estado_nombre = None
        try:
            hs = orden.get('historial_estados') or []
            if hs:
                ultimo = hs[-1]
                estado_nombre = ultimo.get('estado_nombre') or ultimo.get('estado') or None
        except Exception:
            estado_nombre = None
        if not estado_nombre:
            estado_nombre = orden.get('estado') or 'actualizado'

        # Construir saludo incluyendo nombre del cliente cuando esté disponible
        try:
            nombre = ''
            apellido = ''
            if cliente:
                nombre = cliente.get('nombre') or ''
                apellido = cliente.get('apellido') or ''
            nombre_completo = f"{nombre} {apellido}".strip()
            saludo = f"Estimado/a {nombre_completo}," if nombre_completo else "Estimado/a cliente,"
        except Exception:
            saludo = "Estimado/a cliente,"

        texto = (
            f"{saludo}\n\n"
            f"Le informamos que su orden N.º {nroDeOrden} ha sido actualizada al estado: '{estado_nombre}'.\n"
        )

        # Si el nuevo estado es 'PendienteDeRetiro' agregamos la fecha límite de retiro
        try:
            # Normalizar nombre de estado para comparación
            estado_norm = (estado_nombre or '').replace(' ', '').lower()
            if 'pendientederetiro' in estado_norm:
                # Intentar obtener fechaInicioRetiro desde la orden
                fecha_inicio_retiro = orden.get('fechaInicioRetiro') or None
                if fecha_inicio_retiro:
                    # Puede venir como string ISO o como date; intentar parsear
                    try:
                        if isinstance(fecha_inicio_retiro, str):
                            from datetime import datetime as _dt
                            fecha_obj = _dt.fromisoformat(fecha_inicio_retiro).date()
                        else:
                            fecha_obj = fecha_inicio_retiro
                    except Exception:
                        fecha_obj = datetime.now().date()
                else:
                    # No hay fechaInicioRetiro guardada: usar hoy
                    fecha_obj = datetime.now().date()

                # Asumir plazo por defecto de 30 días desde que se marca como reparada
                try:
                    plazo_dias = 30
                    fecha_limite = fecha_obj + timedelta(days=plazo_dias)
                    fecha_limite_str = fecha_limite.strftime('%d/%m/%Y')
                    texto += f"\n\nFecha límite para retiro: {fecha_limite_str}.\n"
                except Exception:
                    fecha_limite_str = None
                    texto += "\n"

                # Añadir instrucciones amables
                texto += "Por favor retire su equipo dentro del plazo indicado.\n\n"
        except Exception:
            # Si algo falla en el cálculo no rompemos la notificación
            texto += "\n\n"

        texto += (
            f"Gracias por confiar en nosotros.\n"
            f"Atentamente,\n"
            f"El Mundo del Celular"
        )
        any_sent = False
        try:
            send_text(numero, texto)
            any_sent = True
        except Exception:
            import traceback
            traceback.print_exc()

        # Intentar notificar por email también (no bloqueante). Se comporta igual que WhatsApp: intento silencioso.
        try:
            # Determinar email del cliente
            destinatario_email = None
            if cliente:
                destinatario_email = cliente.get('email') or cliente.get('mail') or cliente.get('mailResponsable')

            if destinatario_email:
                print(f"[notify] Intentando notificar por Email a: {destinatario_email} para orden {nroDeOrden} estado {estado_nombre}")
                try:
                    from gmail import notify_status_change
                    # Calcular fecha límite si corresponde al estado PendienteDeRetiro
                    deadline_str = None
                    try:
                        estado_norm = (estado_nombre or '').replace(' ', '').lower()
                        if 'pendientederetiro' in estado_norm:
                            fecha_inicio_retiro = orden.get('fechaInicioRetiro') or None
                            if fecha_inicio_retiro and isinstance(fecha_inicio_retiro, str):
                                from datetime import datetime as _dt
                                fecha_obj = _dt.fromisoformat(fecha_inicio_retiro).date()
                            elif fecha_inicio_retiro:
                                fecha_obj = fecha_inicio_retiro
                            else:
                                fecha_obj = datetime.now().date()
                            fecha_limite = fecha_obj + timedelta(days=30)
                            deadline_str = fecha_limite.strftime('%d/%m/%Y')
                    except Exception:
                        deadline_str = None

                    # Usamos None como old_state porque desde aquí no tenemos el estado anterior; new_state es estado_nombre
                    notify_status_change(destinatario_email, nroDeOrden, None, estado_nombre, deadline_date=deadline_str)
                    any_sent = True
                    print(f"[notify] Email notificación enviada (invocado notify_status_change) a {destinatario_email}")
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    print(f"[notify] Error al enviar notificación por Email a {destinatario_email}: {e}")
        except Exception:
            # Cualquier error en la rama de email no debe afectar el flujo
            import traceback
            traceback.print_exc()

        return any_sent
    except Exception:
        import traceback
        traceback.print_exc()
        return False


@bp.route('/ordenes/<int:nroDeOrden>/pdf/download', methods=['GET'])
@cross_origin()
def descargar_pdf_orden(nroDeOrden):
    """
    Endpoint que devuelve el PDF como attachment (descarga).
    Usa `send_file` con `as_attachment=True` para forzar descarga y asegurar
    que el archivo sea entregable por clientes/descargadores y por servicios de subida.
    """
    try:
        pdf_bytes = _build_pdf_bytes(nroDeOrden)
    except FileNotFoundError:
        return jsonify({'error': 'Orden no encontrada'}), 404
    except Exception as e:
        return jsonify({'error': f'Error al generar PDF: {str(e)}'}), 500

    bio = BytesIO(pdf_bytes)
    bio.seek(0)
    # send_file soporta `download_name` en Flask >=2.0; en versiones antiguas se usa attachment_filename
    filename = f"Comprobante_Orden_{nroDeOrden}.pdf"
    try:
        return send_file(bio, mimetype='application/pdf', as_attachment=True, download_name=filename)
    except TypeError:
        # fallback para Flask antiguos
        return send_file(bio, mimetype='application/pdf', as_attachment=True, attachment_filename=filename)


@bp.route('/ordenes/<int:nroDeOrden>/pdf/publish', methods=['POST'])
@cross_origin()
def publicar_pdf_orden(nroDeOrden):
    """
    Genera el PDF y lo sube a un hosting público (transfer.sh). Devuelve JSON con `pdf_url`.
    Body (opcional JSON): { "filename": "mi_nombre.pdf" }
    """
    try:
        pdf_bytes = _build_pdf_bytes(nroDeOrden)
    except FileNotFoundError:
        return jsonify({'error': 'Orden no encontrada'}), 404
    except Exception as e:
        return jsonify({'error': f'Error al generar PDF: {str(e)}'}), 500

    filename = request.json.get('filename') if request.is_json else None
    if not filename:
        filename = f"Comprobante_Orden_{nroDeOrden}.pdf"

    # Subir usando helper en whatsapp.py (no confundir con envío)
    try:
        from whatsapp import upload_to_transfersh
        pdf_url = upload_to_transfersh(pdf_bytes, filename)
    except Exception as e:
        return jsonify({'error': f'Error al subir PDF: {str(e)}'}), 500

    return jsonify({'pdf_url': pdf_url}), 200


@bp.route('/ordenes/<int:nroDeOrden>/pdf/send', methods=['POST'])
@cross_origin()
def enviar_pdf_por_whatsapp(nroDeOrden):
    """
    Genera el PDF, lo sube a transfer.sh y envía el link como documento por WhatsApp usando la Cloud API.
    Request JSON: { "destinatario": "549351...", "caption": "Texto opcional" }
    """
    # Responder inmediatamente a preflight OPTIONS para satisfacer CORS
    if request.method == 'OPTIONS':
        return make_response('', 200)

    data = request.get_json() or {}
    destinatario = data.get('destinatario')
    caption = data.get('caption') or f'Comprobante Orden {nroDeOrden}'
    if not destinatario:
        return jsonify({'error': 'Campo destinatario requerido (número en formato internacional)'}), 400

    try:
        pdf_bytes = _build_pdf_bytes(nroDeOrden)
    except FileNotFoundError:
        return jsonify({'error': 'Orden no encontrada'}), 404
    except Exception as e:
        return jsonify({'error': f'Error al generar PDF: {str(e)}'}), 500

    filename = f"Comprobante_Orden_{nroDeOrden}.pdf"

    # Preferir subir los bytes directamente a WhatsApp si la función está disponible
    from whatsapp import enviar_whatsapp_pdf_bytes, upload_to_transfersh, enviar_whatsapp_pdf
    try:
        result = enviar_whatsapp_pdf_bytes(pdf_bytes=pdf_bytes, nroDeOrden=nroDeOrden, destinatario=destinatario, caption=caption, filename=filename)
        # cuando se suben bytes directamente no hay pdf_url público, pero podemos devolver un placeholder
        return jsonify({'success': True, 'method': 'direct_upload', 'whatsapp_result': result}), 200
    except Exception as e_bytes:
        # si falla la subida directa, intentar la vía transfer.sh como fallback
        try:
            pdf_url = upload_to_transfersh(pdf_bytes, filename)
        except Exception as e_up:
            return jsonify({'error': f'Error al subir PDF (directo y transfer.sh fallaron): direct_error={str(e_bytes)}; transfer_error={str(e_up)}'}), 500

        try:
            result = enviar_whatsapp_pdf(pdf_url=pdf_url, nroDeOrden=nroDeOrden, destinatario=destinatario, caption=caption, filename=filename)
        except Exception as e_send:
            return jsonify({'error': f'Error al enviar por WhatsApp (via transfer): {str(e_send)}', 'pdf_url': pdf_url}), 500

        return jsonify({'success': True, 'method': 'transfer_sh', 'pdf_url': pdf_url, 'whatsapp_result': result}), 200


@bp.route('/ordenes/<int:nroDeOrden>/pdf/send_email', methods=['POST'])
@cross_origin()
def enviar_pdf_por_email(nroDeOrden):
    """
    Genera el PDF en memoria y lo envía por email al cliente asignado para la orden.
    Request JSON opcional: { "email": "destinatario@dominio", "subject": "Asunto opcional", "body": "Texto opcional" }
    Si no se proporciona `email`, se intentará obtener el mail del cliente asociado a la orden.
    """
    # Responder a preflight OPTIONS
    if request.method == 'OPTIONS':
        return make_response('', 200)

    data = request.get_json() or {}
    provided_email = data.get('email')
    subject = data.get('subject')
    body = data.get('body')

    try:
        pdf_bytes = _build_pdf_bytes(nroDeOrden)
    except FileNotFoundError:
        return jsonify({'error': 'Orden no encontrada'}), 404
    except Exception as e:
        return jsonify({'error': f'Error al generar PDF: {str(e)}'}), 500

    # Determinar destinatario: prioridad a email provisto en el body, sino obtener del cliente de la orden
    destinatario = None
    if provided_email:
        destinatario = provided_email
    else:
        # Reutilizar obtener_ordenes para obtener datos de cliente
        from ABMC_db import obtener_ordenes
        ordenes = obtener_ordenes(mode='detail', nroDeOrden=nroDeOrden)
        if ordenes:
            orden = ordenes[0]
            cliente = orden.get('cliente') if isinstance(orden.get('cliente'), dict) else None
            if not cliente and isinstance(orden.get('dispositivo'), dict):
                cliente = orden.get('dispositivo', {}).get('cliente') if isinstance(orden.get('dispositivo', {}).get('cliente'), dict) else None
            if cliente:
                destinatario = cliente.get('email') or cliente.get('mail')

    if not destinatario:
        return jsonify({'error': 'No se encontró un email destinatario para esta orden. Pasa {"email": "x@y"} en el body si querés forzar uno.'}), 400

    # Preparar asunto y cuerpo
    if not subject:
        subject = f"Comprobante - Orden {nroDeOrden} | El Mundo del Celular"
    if not body:
        body = (
            f"Estimado/a cliente,\n\n"
            f"Adjuntamos el comprobante correspondiente a la orden número {nroDeOrden}.\n\n"
            f"Gracias por confiar en nosotros.\n\n"
            f"Atentamente,\n"
            f"El Mundo del Celular"
        )

    # Enviar usando el helper de gmail
    try:
        from gmail import send_pdf_bytes
        send_pdf_bytes(destinatario, nroDeOrden, pdf_bytes, filename=f"Comprobante_Orden_{nroDeOrden}.pdf", body=body)
    except Exception as e:
        return jsonify({'error': f'Error al enviar por email: {str(e)}'}), 500

    return jsonify({'success': True, 'email': destinatario}), 200
    
@bp.route('/ordenes/<int:nroDeOrden>/preview', methods=['GET'])
@cross_origin()
def preview_pdf_orden(nroDeOrden):
    """
    Muestra una página HTML con el PDF embebido para previsualización.
    """
    html_content = f"""
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Previsualización - Orden de Reparación #{nroDeOrden}</title>
        <style>
            body {{
                margin: 0;
                padding: 20px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f8f9fa;
                color: #333;
            }}
            .container {{
                max-width: 1200px;
                margin: 0 auto;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
                overflow: hidden;
            }}
            .header {{
                background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
                color: white;
                padding: 25px;
                text-align: center;
                position: relative;
            }}
            .header h1 {{
                margin: 0;
                font-size: 28px;
                font-weight: 300;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }}
            .header p {{
                margin: 8px 0 0 0;
                opacity: 0.9;
                font-size: 16px;
            }}
            .pdf-container {{
                background: #f8f9fa;
                padding: 20px;
                min-height: 600px;
                display: flex;
                justify-content: center;
                align-items: flex-start;
            }}
            .pdf-viewer {{
                width: 100%;
                max-width: 800px;
                height: 600px;
                border: 2px solid #e9ecef;
                border-radius: 8px;
                background: white;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            }}
            .actions {{
                background: #f8f9fa;
                padding: 20px;
                border-top: 1px solid #dee2e6;
                display: flex;
                justify-content: center;
                gap: 15px;
                flex-wrap: wrap;
            }}
            .btn {{
                background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
                font-weight: 500;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                transition: all 0.3s ease;
                box-shadow: 0 2px 8px rgba(40, 167, 69, 0.3);
            }}
            .btn:hover {{
                transform: translateY(-2px);
                box-shadow: 0 4px 15px rgba(40, 167, 69, 0.4);
            }}
            .btn:active {{
                transform: translateY(0);
            }}
            .btn-secondary {{
                background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
                box-shadow: 0 2px 8px rgba(108, 117, 125, 0.3);
            }}
            .btn-secondary:hover {{
                box-shadow: 0 4px 15px rgba(108, 117, 125, 0.4);
            }}
            .btn i {{
                font-size: 18px;
            }}
            .print-notice {{
                background: #e3f2fd;
                border: 1px solid #bbdefb;
                border-radius: 6px;
                padding: 12px 16px;
                margin: 15px 20px;
                font-size: 14px;
                color: #1976d2;
                text-align: center;
            }}
            .print-notice i {{
                margin-right: 8px;
            }}
            @media print {{
                .header, .actions, .print-notice {{
                    display: none !important;
                }}
                .pdf-container {{
                    padding: 0;
                    background: white;
                }}
                .pdf-viewer {{
                    border: none;
                    box-shadow: none;
                    height: auto;
                }}
            }}
            @media (max-width: 768px) {{
                .pdf-viewer {{
                    height: 500px;
                }}
                .actions {{
                    flex-direction: column;
                    align-items: center;
                }}
                .btn {{
                    width: 200px;
                    justify-content: center;
                }}
            }}
        </style>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1><i class="fas fa-file-pdf"></i> Orden de Reparación #{nroDeOrden}</h1>
                <p>Previsualización del comprobante</p>
            </div>
            
            <div class="print-notice">
                <i class="fas fa-info-circle"></i>
                Este documento está optimizado para impresión en blanco y negro
            </div>
            
            <div class="pdf-container">
                <object 
                    class="pdf-viewer" 
                    data="/ordenes/{nroDeOrden}/pdf" 
                    type="application/pdf">
                    <p>Tu navegador no puede mostrar PDFs. 
                       <a href="/ordenes/{nroDeOrden}/pdf" class="btn">
                           <i class="fas fa-download"></i> Descargar PDF
                       </a>
                    </p>
                </object>
            </div>
            
            <div class="actions">
                <a href="/ordenes/{nroDeOrden}/pdf" class="btn" download>
                    <i class="fas fa-download"></i> Descargar PDF
                </a>
                <button class="btn btn-secondary" onclick="window.print()">
                    <i class="fas fa-print"></i> Imprimir
                </button>
                <button class="btn btn-secondary" onclick="window.close()">
                    <i class="fas fa-times"></i> Cerrar
                </button>
            </div>
        </div>
    </body>
    </html>
    """
    return html_content


@bp.route('/ordenes/<int:nroDeOrden>/comprobante-retiro', methods=['GET'])
@cross_origin()
def comprobante_retiro(nroDeOrden):
    """
    Genera un comprobante de retiro (PDF) para la orden indicado.
    Intenta usar la fecha de retiro (fechaInicioRetiro) si existe, o la última
    fecha de estado que contenga 'retir' si está disponible.
    """
    try:
        from ABMC_db import obtener_ordenes
        ordenes = obtener_ordenes(mode='detail', nroDeOrden=nroDeOrden)
        if not ordenes:
            return jsonify({'error': 'Orden no encontrada'}), 404

        orden = ordenes[0]

        # determinar fecha de retiro
        fecha_retiro = orden.get('fechaInicioRetiro') or None
        if not fecha_retiro:
            # buscar en historial_estados una entrada con 'retir' en el nombre u observaciones
            hs = orden.get('historial_estados', [])
            for h in reversed(hs):
                obs = (h.get('observaciones') or '').lower()
                estado_nombre = (h.get('estado_nombre') or '')
                if 'retir' in obs or 'retir' in (estado_nombre or '').lower() or 'retir' in (h.get('observaciones') or '').lower():
                    fecha_retiro = h.get('fechaCambio')
                    break

        if not fecha_retiro:
            fecha_retiro = datetime.now().isoformat()

        # construir PDF con layout tipo 'orden de retiro' parecido al diseño entregado
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter,
                              rightMargin=36, leftMargin=36,
                              topMargin=36, bottomMargin=36)
        styles = getSampleStyleSheet()
        normal = styles['Normal']
        normal.fontSize = 9
        title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=28, alignment=1, fontName='Helvetica-Bold', textColor=colors.HexColor('#123847'))
        section_style = ParagraphStyle('Section', parent=styles['Heading2'], fontSize=11, fontName='Helvetica-Bold', textColor=colors.HexColor('#0d6b66'))
        small = ParagraphStyle('Small', parent=styles['Normal'], fontSize=9, textColor=colors.gray)

        elements = []

        # Header: logo izquierdo, título grande a la derecha
        logo_path = os.path.join(os.path.dirname(__file__), 'static', 'logo.png')
        logo_exists = os.path.exists(logo_path)
        logo_img = Image(logo_path, 1.6*inch, 1.6*inch) if logo_exists else ''

        header_right = [
            Paragraph('ORDEN DE RETIRO', title_style),
            Spacer(1,6),
            Paragraph('Orden Nro: <b>%s</b>' % (orden.get('nroDeOrden','')), small),
            Paragraph('Fecha: <b>%s</b>' % (orden.get('fecha','')), small)
        ]

        # Hacer que el cuadro beige sea el fondo del header (se extiende detrás del logo y título)
        header_table = Table([[logo_img, header_right]], colWidths=[1.8*inch, 5.2*inch], rowHeights=[1.9*inch])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('ALIGN', (1,0), (1,0), 'RIGHT'),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            # Fondo beige que cubre ambas celdas del header y se extiende hacia abajo
            ('BACKGROUND', (0,0), (1,0), colors.HexColor('#f0eede')),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 12))

        # Info cliente (izquierda) y datos orden (derecha)
        # Construir bloque de cliente con campos separados si están disponibles
        cliente_text_lines = []
        cliente = orden.get('cliente') if isinstance(orden.get('cliente'), dict) else None
        if not cliente and isinstance(orden.get('dispositivo'), dict):
            cliente = orden.get('dispositivo', {}).get('cliente') if isinstance(orden.get('dispositivo', {}).get('cliente'), dict) else None

        if cliente:
            nombre = cliente.get('nombre') or ''
            apellido = cliente.get('apellido') or ''
            if nombre or apellido:
                cliente_text_lines.append(f"Nombre: {nombre} {apellido}".strip())
            nro_doc = cliente.get('numeroDoc') or cliente.get('dni') or cliente.get('documento')
            if nro_doc:
                cliente_text_lines.append(f"Documento: {nro_doc}")
            telefono = cliente.get('telefono') or cliente.get('telefonoCelular') or cliente.get('telefonoContacto')
            if telefono:
                cliente_text_lines.append(f"Tel: {telefono}")
            email = cliente.get('email') or cliente.get('mail')
            if email:
                cliente_text_lines.append(f"Email: {email}")
            direccion = cliente.get('direccion') or cliente.get('domicilio') or cliente.get('direccionFiscal')
            if direccion:
                cliente_text_lines.append(f"Domicilio: {direccion}")
        else:
            if orden.get('cliente_info'):
                cliente_text_lines.append(orden.get('cliente_info'))
            else:
                cliente_text_lines.append('No disponible')

        cliente_block_text = '<br/>'.join(cliente_text_lines)
        cliente_block = Paragraph('<b>INFORMACIÓN DEL CLIENTE</b><br/>' + cliente_block_text, normal)
        orden_block = Paragraph('<b>ORDEN NRO:</b><br/>' + str(orden.get('nroDeOrden') or '') + '<br/><br/><b>FECHA:</b><br/>' + str(fecha_retiro), normal)
        info_table = Table([[cliente_block, orden_block]], colWidths=[4.6*inch, 2.4*inch])
        info_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ]))
        elements.append(info_table)
        elements.append(Spacer(1, 16))

        # Detalles: tabla con cabecera destacada
        detalles = orden.get('detalles') or []
        data = [[Paragraph('<b>DETALLE</b>', section_style), Paragraph('<b>Subtotal</b>', section_style)]]
        if detalles:
            for det in detalles:
                desc = det.get('servicioDescripcion') or det.get('repuestoDescripcion') or det.get('descripcion') or ''
                subtotal = det.get('subtotal', det.get('precio', 0)) or 0
                data.append([Paragraph(str(desc), normal), Paragraph(f"${float(subtotal):.2f}", normal)])
        else:
            # filas vacías para mantener layout similar
            data.append([Paragraph('-', normal), Paragraph('$0.00', normal)])

        table = Table(data, colWidths=[5.0*inch, 1.0*inch])
        table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#7fb6b1')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('ALIGN', (1,1), (1,-1), 'RIGHT'),
            ('GRID', (0,0), (-1,-1), 0.25, colors.HexColor('#d9e6e3')),
            ('LEFTPADDING', (0,0), (-1,-1), 8),
            ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ]))
        elements.append(table)
        elements.append(Spacer(1, 12))

        # Total destacado (usar precioTotal si existe)
        precio_total = orden.get('precioTotal')
        if precio_total is None:
            # intentar sumar subtotales
            try:
                precio_total = sum([float(d.get('subtotal', d.get('precio', 0) or 0)) for d in detalles])
            except Exception:
                precio_total = 0

        total_table = Table([[Paragraph('<b>TOTAL</b>', ParagraphStyle('TotLab', parent=styles['Normal'], fontSize=10, alignment=1, textColor=colors.white)), Paragraph(f"${float(precio_total):.2f}", ParagraphStyle('TotVal', parent=styles['Normal'], fontSize=10, alignment=1, textColor=colors.white))]], colWidths=[5.0*inch, 1.0*inch])
        total_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#2c6f6a')),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('INNERGRID', (0,0), (-1,-1), 0.25, colors.white),
            ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#2c6f6a')),
            ('LEFTPADDING', (0,0), (-1,-1), 6),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ]))
        elements.append(total_table)
        elements.append(Spacer(1, 24))

        # Pie: intentar incluir robot decorativo a la izquierda y firma a la derecha
        # Preferencia de ruta: usuario Downloads (si existe) -> Backend/static/robot.png
        user_robot_path = r"C:\Users\LENOVO\Downloads\repi destornillador.png"
        static_robot_path = os.path.join(os.path.dirname(__file__), 'static', 'robot.png')
        robot_img = None
        if os.path.exists(user_robot_path):
            try:
                robot_img = Image(user_robot_path, 1.6*inch, 1.6*inch)
            except Exception:
                robot_img = None
        elif os.path.exists(static_robot_path):
            try:
                robot_img = Image(static_robot_path, 1.6*inch, 1.6*inch)
            except Exception:
                robot_img = None

        sig_table = Table([[Paragraph('Firma', small), '______________________________']], colWidths=[1.5*inch, 4.5*inch])
        sig_table.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE')]))

        if robot_img:
            footer_row = [[robot_img, sig_table]]
            footer_table = Table(footer_row, colWidths=[1.8*inch, 5.2*inch])
            footer_table.setStyle(TableStyle([('VALIGN', (0,0), (-1,-1), 'MIDDLE'), ('LEFTPADDING',(0,0),(0,0),6)]))
            elements.append(footer_table)
        else:
            elements.append(sig_table)
        elements.append(Spacer(1, 6))
        elements.append(Paragraph('Gracias por confiar en nuestros servicios técnicos.', small))

        # Disclaimer de responsabilidad
        elements.append(Spacer(1, 12))
        disclaimer_style = ParagraphStyle(
            'Disclaimer',
            parent=styles['Normal'],
            fontSize=7,
            textColor=colors.HexColor('#333333'),
            alignment=4,  # Justified
            leading=9,
            leftIndent=10,
            rightIndent=10
        )
        disclaimer_text = (
            "<b>IMPORTANTE:</b> Para retirar el producto deberá presentarse este comprobante. "
            "Transcurrido 30 días de la fecha de la presente facturaremos por almacenaje y el precio de la reparación "
            "será actualizado según la lista de precios vigentes. Si el producto no fuera retirado dentro del plazo "
            "de 60 días de la fecha de la presente será considerado abandonado en los términos de los artículos 2525 y 2526 "
            "del Código Civil, quedando facultados a darle el destino que consideremos pertinente."
        )
        elements.append(Paragraph(disclaimer_text, disclaimer_style))

        # Generar PDF
        doc.build(elements)
        buffer.seek(0)
        resp = make_response(buffer.getvalue())
        resp.headers['Content-Type'] = 'application/pdf'
        resp.headers['Content-Disposition'] = f'inline; filename=comprobante_retiro_{nroDeOrden}.pdf'
        return resp
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Error al generar comprobante: {str(e)}'}), 500


@bp.route('/ordenes/<int:nroDeOrden>/comprobante-retiro/preview', methods=['GET'])
@cross_origin()
def preview_comprobante_retiro(nroDeOrden):
            logo_url = '/static/logo.png'
            html_template = """
            <!doctype html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width,initial-scale=1">
                <title>Orden de Retiro #__NRO__</title>
                <style>
                    body { margin:0; padding:20px; background:#f2f4f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; }
                    .card { max-width:900px; margin:0 auto; background:#fff; border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,0.08); overflow:hidden; }
                    .header { display:flex; align-items:center; gap:16px; padding:20px 28px; border-bottom:1px solid #e9edf2; }
                    .logo { height:72px; width:auto; }
                    .title { flex:1; text-align:right; color:#123847; font-weight:800; font-size:30px; letter-spacing:3px; }
                    .pdf-wrap { padding:20px; }
                    .actions { display:flex; gap:12px; justify-content:center; padding:18px; border-top:1px solid #e9edf2; background:#fafbfc; }
                    .btn { display:inline-block; background:#0b8f6b; color:white; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600; }
                    .btn.secondary { background:#6c757d; }
                    @media print { .header, .actions { display:none!important; } .pdf-wrap { padding:0; } }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="header">
                        <div style="flex:0 0 auto;"><img src="__LOGO_URL__" class="logo" alt="logo" onerror="this.style.display='none'"/></div>
                        <div class="title">COMPROBANTE<br/>DE RETIRO<br/><small style="font-size:12px; font-weight:600; color:#4b6b7a;">Orden #__NRO__</small></div>
                    </div>
                    <div class="pdf-wrap">
                        <object data="/ordenes/__NRO__/comprobante-retiro" type="application/pdf" width="100%" height="720px">
                            <p>Tu navegador no puede mostrar el PDF. <a href="/ordenes/__NRO__/comprobante-retiro">Descargar Orden de Retiro</a></p>
                        </object>
                    </div>
                    <div class="actions">
                        <a class="btn" href="/ordenes/__NRO__/comprobante-retiro" download><i class="fa fa-download"></i>&nbsp;Descargar PDF</a>
                        <a class="btn secondary" href="#" onclick="window.print();return false;">Imprimir</a>
                        <a class="btn secondary" href="#" onclick="window.close();return false;">Cerrar</a>
                    </div>
                </div>
            </body>
            </html>
            """
            # usar reemplazo simple para no interpretar llaves del CSS
            html = html_template.replace('__NRO__', str(nroDeOrden)).replace('__LOGO_URL__', logo_url)
            return html


# ----------------- Reportes -----------------
def _normalize_text(s):
    if not s:
        return ''
    s = unicodedata.normalize('NFKD', str(s))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return ''.join(ch for ch in s.lower() if ch.isalnum())


def _serialize_order_for_report(o):
    d = getattr(o, 'dispositivo', None)
    e = getattr(o, 'empleado', None)
    c = getattr(d, 'cliente', None) if d else None
    dispositivo_info = f"{getattr(d,'marca','') or ''} {getattr(d,'modelo','') or ''} ({getattr(d,'nroSerie','') or ''})".strip() if d else None
    precio_total = 0
    try:
        from ABMC_db import calcular_precio_total_orden_obj
        precio_total = float(calcular_precio_total_orden_obj(o))
    except Exception:
        precio_total = 0

    ultimo_estado = None
    if getattr(o, 'historial_estados', None):
        ultimo_estado = sorted(o.historial_estados, key=lambda h: getattr(h, 'fechaCambio', None) or 0, reverse=True)[0]

    return {
        'nroDeOrden': getattr(o, 'nroDeOrden', None),
        'fecha': getattr(o, 'fecha', None).isoformat() if getattr(o, 'fecha', None) else None,
        'cliente_info': f"{getattr(c,'nombre','') or ''} {getattr(c,'apellido','') or ''} ({getattr(c,'numeroDoc','') or ''})".strip() if c else None,
        'dispositivo_info': dispositivo_info,
        'idEmpleado': getattr(o, 'idEmpleado', None),
        'empleado_info': f"{getattr(e,'nombre','') or ''} {getattr(e,'apellido','') or ''}".strip() if e else None,
        'resultado': getattr(o, 'resultado', None),
        'estado': getattr(getattr(ultimo_estado, 'estado', None), 'nombre', None) if ultimo_estado else None,
        'fechaInicioRetiro': getattr(o, 'fechaInicioRetiro', None).isoformat() if getattr(o, 'fechaInicioRetiro', None) else None,
        'precioTotal': precio_total
    }


def _add_soft_breaks(s, maxlen=25):
    """Insert zero-width spaces into long tokens so ReportLab Paragraph can wrap them.
    Breaks any token longer than maxlen by inserting '\u200b' every maxlen chars.
    """
    if not s:
        return s
    try:
        parts = str(s).split()
        out = []
        for p in parts:
            if len(p) <= maxlen:
                out.append(p)
            else:
                # insert zero-width space every maxlen chars
                chunks = [p[i:i+maxlen] for i in range(0, len(p), maxlen)]
                out.append('\u200b'.join(chunks))
        return ' '.join(out)
    except Exception:
        return s


def _strip_serial(s):
    """Remove common serial patterns in parentheses like (SN12345) to shorten display in PDFs."""
    if not s:
        return s
    try:
        import re
        # remove parenthesis content that looks like SN or long alphanumeric tokens
        return re.sub(r"\s*\([^\)]*(SN|sn|s/n|nro|serial)[^\)]*\)", '', str(s))
    except Exception:
        return s


def _truncate_display(s, max_chars=40):
    if not s:
        return s
    s = str(s)
    if len(s) <= max_chars:
        return s
    return s[:max_chars-3].rstrip() + '...'

# ------------------------------------------------------------------------
def _draw_header_footer(canvas, doc):
    """
    Dibuja en cada página:
     - Barra superior pegada al borde (color #85abab), angosta
     - Título centrado: "El Mundo del Celular"
     - Dirección y teléfono centrados debajo del título (todo en negro)
     - Logo en esquina superior derecha, CENTRADO VERTICALMENTE DENTRO DEL HEADER
       (logo totalmente dentro de la barra, para evitar solapamiento con la tabla)
     - Número de página en esquina inferior derecha respetando márgenes
    """
    try:
        canvas.saveState()
        width, height = doc.pagesize

        # ===== Ajustes principales =====
        header_h = 72         # altura de la barra (angosta)
        img_w = 80            # ancho del logo en puntos (reducido para evitar solapes)
        img_h = 80            # alto del logo en puntos
        # ===============================

        # Barra superior (pegada al borde superior)
        canvas.setFillColor(colors.HexColor('#85abab'))
        canvas.rect(0, height - header_h, width, header_h, stroke=0, fill=1)

        # Ruta del logo (Backend/static/logo.png)
        logo_path = os.path.join(os.path.dirname(__file__), 'static', 'logo.png')

        # Dibujar logo de forma que quede CENTRADO verticalmente dentro del header:
        try:
            if os.path.exists(logo_path):
                from reportlab.lib.utils import ImageReader
                img = ImageReader(logo_path)
                # Posición X (alineado hacia la derecha, dentro del margen)
                x = width - doc.rightMargin - img_w
                # Centrar verticalmente dentro del área del header:
                # header verticalmente va de (height-header_h) hasta height
                y = (height - header_h) + ( (header_h - img_h) / 2.0 )
                canvas.drawImage(img, x, y, img_w, img_h, preserveAspectRatio=True, mask='auto')
        except Exception:
            # no interrumpir si falla el logo
            pass

        # Todo el texto en color NEGRO
        canvas.setFillColor(colors.black)

        # Título principal "El Mundo del Celular" - centrado dentro del header
        canvas.setFont('Helvetica-Bold', 18)
        # Y del título colocado dentro del header (ajustable si querés moverlo)
        y_title = (height - header_h) + header_h * 0.62
        canvas.drawCentredString(width / 2.0, y_title, "El Mundo del Celular")

        # Dirección y teléfono centrados debajo del título (espaciado pequeño)
        canvas.setFont('Helvetica', 9)
        y_addr = y_title - 16
        canvas.drawCentredString(width / 2.0, y_addr, "Dirección: Av. Duarte Quirós 1563")
        y_tel = y_addr - 12
        canvas.drawCentredString(width / 2.0, y_tel, "Teléfono: 0351156263575")

        # Número de página en esquina inferior derecha (dentro de márgenes)
        canvas.setFont('Helvetica', 8)
        page_num_text = f"Página {doc.page}"
        y_page = doc.bottomMargin - 8 if doc.bottomMargin > 16 else 10
        canvas.drawRightString(width - doc.rightMargin, y_page, page_num_text)

        canvas.restoreState()
    except Exception:
        try:
            canvas.restoreState()
        except Exception:
            pass
# ------------------------------------------------------------------------

@bp.route('/reportes/reparados', methods=['GET'])
@cross_origin()
def reporte_reparados():
    """Devuelve un reporte de órdenes reparadas en un rango de fecha.
    Query params: desde=YYYY-MM-DD, hasta=YYYY-MM-DD, format=(json|pdf)
    Criterio: se considera reparada si `resultado` contiene 'reparad' o el último estado contiene 'Retirada' o 'Reparacion'.
    """
    desde = request.args.get('desde')
    hasta = request.args.get('hasta')
    fmt = (request.args.get('format') or 'json').lower()

    # Validar formato de fechas (si se pasaron)
    try:
        fecha_desde = datetime.strptime(desde, '%Y-%m-%d').date() if desde else None
    except Exception:
        return jsonify({'error': "Parámetro 'desde' inválido. Use formato YYYY-MM-DD"}), 400
    try:
        fecha_hasta = datetime.strptime(hasta, '%Y-%m-%d').date() if hasta else None
    except Exception:
        return jsonify({'error': "Parámetro 'hasta' inválido. Use formato YYYY-MM-DD"}), 400
    if fecha_desde and fecha_hasta and fecha_desde > fecha_hasta:
        return jsonify({'error': "Rango inválido: 'desde' no puede ser posterior a 'hasta'"}), 400

    try:
        from ABMC_db import session_scope
        from BDD.database import OrdenDeReparacion
        with session_scope() as s:
            q = s.query(OrdenDeReparacion).order_by(OrdenDeReparacion.nroDeOrden)
            if fecha_desde:
                q = q.filter(OrdenDeReparacion.fecha >= fecha_desde)
            if fecha_hasta:
                q = q.filter(OrdenDeReparacion.fecha <= fecha_hasta)
            ordenes = q.all()

            filas = []
            for o in ordenes:
                # criterio reparado
                res_norm = _normalize_text(getattr(o, 'resultado', '') or '')
                last_estado = None
                if getattr(o, 'historial_estados', None):
                    last_estado = getattr(o, 'historial_estados', [])[-1]
                estado_norm = _normalize_text(getattr(getattr(last_estado, 'estado', None), 'nombre', '') or '')

                if 'reparad' in res_norm or 'retirad' in estado_norm or 'reparacion' in estado_norm:
                    filas.append(_serialize_order_for_report(o))

            # calcular resumen
            summary = {
                'total': len(filas),
                'average_days_to_repair': None,
                'by_tecnico': {},
                'by_tipo_reparacion': {},
            }
            # intentar calcular tiempo promedio: si hay fecha y fechaInicioRetiro
            dias = []
            for f in filas:
                # fecha: f['fecha'] y retiro: f['fechaInicioRetiro']
                try:
                    if f.get('fecha') and f.get('fechaInicioRetiro'):
                        d1 = datetime.fromisoformat(f.get('fecha')).date()
                        d2 = datetime.fromisoformat(f.get('fechaInicioRetiro')).date()
                        dias.append((d2 - d1).days)
                except Exception:
                    pass
                # contar por técnico
                tec = f.get('empleado_info') or 'Sin técnico'
                summary['by_tecnico'][tec] = summary['by_tecnico'].get(tec, 0) + 1
                # heurística: buscar palabras clave en 'resultado' o 'estado' para tipo de reparación
                tipo = (f.get('resultado') or f.get('estado') or 'otro').lower()
                summary['by_tipo_reparacion'][tipo] = summary['by_tipo_reparacion'].get(tipo, 0) + 1

            if dias:
                summary['average_days_to_repair'] = sum(dias) / len(dias)

            # Responder según formato
           # ------------------------------------------------------------------------
            if fmt == 'pdf':
                # generar PDF con layout en landscape y espacio superior extra para el header gráfico
                buffer = BytesIO()
                # Aumentamos topMargin para dejar espacio al encabezado (header_h en el helper)
                doc = SimpleDocTemplate(buffer, pagesize=landscape(letter),
                                        rightMargin=24, leftMargin=24, topMargin=100, bottomMargin=36)
                styles = getSampleStyleSheet()

                # Título del reporte (fuera del header, centrado, en negrita y más grande)
                title_style = ParagraphStyle('ReportTitle', parent=styles['Heading2'],
                                            fontName='Helvetica-Bold', fontSize=16, alignment=1, textColor=colors.black, spaceAfter=10)
                small = ParagraphStyle('Small', parent=styles['Normal'], fontSize=8, textColor=colors.black)
                header_style = ParagraphStyle('H', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', textColor=colors.black)

                elements = []

                # Ponemos el título principal del reporte aquí (afuera del encabezado)
                elements.append(Paragraph("Reporte - Celulares Reparados", title_style))
                elements.append(Spacer(1, 6))

                # Fecha de emisión (antes del resumen/total)
                fecha_emision = datetime.now().strftime('%d/%m/%Y')
                elements.append(Paragraph(f"Fecha de emisión: {fecha_emision}", small))
                elements.append(Spacer(1, 6))

                # resumen
                resumen_lines = [f"Total reparados: {summary['total']}"]
                if summary['average_days_to_repair'] is not None:
                    resumen_lines.append(f"Tiempo promedio (días): {summary['average_days_to_repair']:.1f}")

                for l in resumen_lines:
                    elements.append(Paragraph(l, small))
                    elements.append(Spacer(1, 4))

                elements.append(Spacer(1, 6))

                # Tabla: combinamos 'Dispositivo' y 'Resultado' en una sola columna
                data = [[Paragraph('Nro', header_style), Paragraph('Fecha', header_style), Paragraph('Cliente', header_style),
                        Paragraph('Dispositivo / Resultado', header_style), Paragraph('Precio', header_style)]]
                for r in filas:
                    nro = Paragraph(str(r.get('nroDeOrden') or ''), small)
                    fecha = Paragraph(r.get('fecha') or '', small)
                    cliente_text = _truncate_display(_strip_serial(r.get('cliente_info') or ''), max_chars=40)
                    dispositivo_text = _truncate_display(_strip_serial(r.get('dispositivo_info') or ''), max_chars=60)
                    resultado_text = _truncate_display(str(r.get('resultado') or r.get('estado') or ''), max_chars=60)
                    combined = (dispositivo_text + ' — ' + resultado_text).strip()
                    cliente = Paragraph(_add_soft_breaks(cliente_text), small)
                    dispositivo_resultado = Paragraph(_add_soft_breaks(combined), small)
                    precio = Paragraph(f"${r.get('precioTotal', 0):.2f}", small)
                    data.append([nro, fecha, cliente, dispositivo_resultado, precio])

                # Ajuste de anchos
                col_widths = [40, 80, 200, 360, 64]
                table = Table(data, colWidths=col_widths, repeatRows=1)
                table.setStyle(TableStyle([
                    ('GRID', (0, 0), (-1, -1), 0.4, colors.black),
                    ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('ALIGN', (4, 1), (4, -1), 'RIGHT'),
                    ('FONTSIZE', (0, 0), (-1, -1), 8),
                    ('LEFTPADDING', (0, 0), (-1, -1), 4),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                ]))
                elements.append(table)

                # Callback para dibujar header/footer en cada página usando la nueva función
                def _on_page(canvas, doc):
                    _draw_header_footer(canvas, doc)

                doc.build(elements, onFirstPage=_on_page, onLaterPages=_on_page)
                buffer.seek(0)
                resp = make_response(buffer.getvalue())
                resp.headers['Content-Type'] = 'application/pdf'
                resp.headers['Content-Disposition'] = 'inline; filename=reporte_reparados.pdf'
                return resp
            # --- FIN BLOQUE ---------------------------------------------------------

            if fmt == 'csv':
                import csv
                import io

                # Usamos StringIO con newline='' para que csv.writer maneje correctamente los finales de línea
                sio = io.StringIO(newline='')
                # Usamos ';' como delimitador (mejor para Excel en locales hispanos) y comillas dobles para campos que lo requieran
                writer = csv.writer(sio, delimiter=';', quotechar='"', quoting=csv.QUOTE_MINIMAL)

                # Cabecera
                writer.writerow(['nroDeOrden', 'fecha', 'cliente', 'dispositivo', 'resultado', 'precioTotal', 'empleado'])

                # Filas: limpieza mínima (no saltos de línea, strings)
                for r in filas:
                    nro = str(r.get('nroDeOrden') or '')
                    fecha = r.get('fecha') or ''
                    cliente = (r.get('cliente_info') or '').replace('\n', ' ').strip()
                    dispositivo = (r.get('dispositivo_info') or '').replace('\n', ' ').strip()
                    resultado = str(r.get('resultado') or r.get('estado') or '').replace('\n', ' ').strip()
                    precio = f"{float(r.get('precioTotal') or 0):.2f}"
                    empleado = (r.get('empleado_info') or '').replace('\n', ' ').strip()

                    writer.writerow([nro, fecha, cliente, dispositivo, resultado, precio, empleado])

                # Añadimos BOM UTF-8 al principio para que Excel reconozca los acentos correctamente
                csv_text = '\ufeff' + sio.getvalue()
                data = csv_text.encode('utf-8')

                resp = make_response(data)
                resp.headers['Content-Type'] = 'text/csv; charset=utf-8'
                resp.headers['Content-Disposition'] = 'attachment; filename=reporte_reparados.csv'
                return resp
            # ----------------------------------------------------------------------------------------------------

            # JSON por defecto: enviar filas y summary
            return jsonify({'summary': summary, 'rows': filas})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/reportes/no-reparados', methods=['GET'])
@cross_origin()
def reporte_no_reparados():
    """Devuelve un reporte de órdenes no reparadas en un rango de fecha.
    Criterio: resultado contiene 'desestim' o 'norepar' o último estado contiene 'PendienteDeRetiro' o 'Abandon'.
    """
    desde = request.args.get('desde')
    hasta = request.args.get('hasta')
    fmt = (request.args.get('format') or 'json').lower()

    # validar fechas
    try:
        fecha_desde = datetime.strptime(desde, '%Y-%m-%d').date() if desde else None
    except Exception:
        return jsonify({'error': "Parámetro 'desde' inválido. Use formato YYYY-MM-DD"}), 400
    try:
        fecha_hasta = datetime.strptime(hasta, '%Y-%m-%d').date() if hasta else None
    except Exception:
        return jsonify({'error': "Parámetro 'hasta' inválido. Use formato YYYY-MM-DD"}), 400
    if fecha_desde and fecha_hasta and fecha_desde > fecha_hasta:
        return jsonify({'error': "Rango inválido: 'desde' no puede ser posterior a 'hasta'"}), 400

    try:
        from ABMC_db import session_scope
        from BDD.database import OrdenDeReparacion
        with session_scope() as s:
            q = s.query(OrdenDeReparacion).order_by(OrdenDeReparacion.nroDeOrden)
            if fecha_desde:
                q = q.filter(OrdenDeReparacion.fecha >= fecha_desde)
            if fecha_hasta:
                q = q.filter(OrdenDeReparacion.fecha <= fecha_hasta)
            ordenes = q.all()

            filas = []
            for o in ordenes:
                res_norm = _normalize_text(getattr(o, 'resultado', '') or '')
                last_estado = None
                if getattr(o, 'historial_estados', None):
                    last_estado = getattr(o, 'historial_estados', [])[-1]
                estado_norm = _normalize_text(getattr(getattr(last_estado, 'estado', None), 'nombre', '') or '')

                if 'desestim' in res_norm or 'norepar' in res_norm or 'pendientederetiro' in estado_norm or 'abandon' in estado_norm:
                    filas.append(_serialize_order_for_report(o))

            # resumen
            summary = {'total': len(filas), 'by_reason': {}, 'by_modelo': {}, 'by_tecnico': {}}
            for f in filas:
                # motivo: tomar 'resultado' o 'informacionAdicional'
                motivo = (f.get('resultado') or 'sin motivo').lower()
                summary['by_reason'][motivo] = summary['by_reason'].get(motivo, 0) + 1
                # modelo desde dispositivo_info heurísticamente
                modelo = (f.get('dispositivo_info') or 'desconocido')
                summary['by_modelo'][modelo] = summary['by_modelo'].get(modelo, 0) + 1
                tec = f.get('empleado_info') or 'Sin técnico'
                summary['by_tecnico'][tec] = summary['by_tecnico'].get(tec, 0) + 1

            # ------------------------------------------------------------------------
            if fmt == 'pdf':
                buffer = BytesIO()
                doc = SimpleDocTemplate(buffer, pagesize=landscape(letter),
                                        rightMargin=24, leftMargin=24, topMargin=100, bottomMargin=36)
                styles = getSampleStyleSheet()

                title_style = ParagraphStyle('ReportTitle', parent=styles['Heading2'],
                                            fontName='Helvetica-Bold', fontSize=16, alignment=1, textColor=colors.black, spaceAfter=10)
                small = ParagraphStyle('Small', parent=styles['Normal'], fontSize=8, textColor=colors.black)
                header_style = ParagraphStyle('H', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', textColor=colors.black)

                elements = []

                # Título del reporte (fuera del header)
                elements.append(Paragraph("Reporte - Celulares No Reparados", title_style))
                elements.append(Spacer(1, 6))

                # Fecha de emisión
                fecha_emision = datetime.now().strftime('%d/%m/%Y')
                elements.append(Paragraph(f"Fecha de emisión: {fecha_emision}", small))
                elements.append(Spacer(1, 6))

                elements.append(Paragraph(f"Total no reparados: {summary['total']}", small))
                elements.append(Spacer(1, 6))

                # Tabla
                data = [[Paragraph('Nro', header_style), Paragraph('Fecha', header_style), Paragraph('Cliente', header_style),
                        Paragraph('Dispositivo / Resultado', header_style), Paragraph('Precio', header_style)]]
                for r in filas:
                    nro = Paragraph(str(r.get('nroDeOrden') or ''), small)
                    fecha = Paragraph(r.get('fecha') or '', small)
                    cliente_text = _truncate_display(_strip_serial(r.get('cliente_info') or ''), max_chars=40)
                    dispositivo_text = _truncate_display(_strip_serial(r.get('dispositivo_info') or ''), max_chars=60)
                    resultado_text = _truncate_display(str(r.get('resultado') or r.get('estado') or ''), max_chars=60)
                    combined = (dispositivo_text + ' — ' + resultado_text).strip()
                    cliente = Paragraph(_add_soft_breaks(cliente_text), small)
                    dispositivo_resultado = Paragraph(_add_soft_breaks(combined), small)
                    precio = Paragraph(f"${r.get('precioTotal', 0):.2f}", small)
                    data.append([nro, fecha, cliente, dispositivo_resultado, precio])

                col_widths = [40, 80, 200, 360, 64]
                table = Table(data, colWidths=col_widths, repeatRows=1)
                table.setStyle(TableStyle([
                    ('GRID', (0, 0), (-1, -1), 0.4, colors.black),
                    ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('ALIGN', (4, 1), (4, -1), 'RIGHT'),
                    ('FONTSIZE', (0, 0), (-1, -1), 8),
                    ('LEFTPADDING', (0, 0), (-1, -1), 4),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 4),
                ]))
                elements.append(table)

                def _on_page(canvas, doc):
                    _draw_header_footer(canvas, doc)

                doc.build(elements, onFirstPage=_on_page, onLaterPages=_on_page)
                buffer.seek(0)
                resp = make_response(buffer.getvalue())
                resp.headers['Content-Type'] = 'application/pdf'
                resp.headers['Content-Disposition'] = 'inline; filename=reporte_no_reparados.pdf'
                return resp
            # --- FIN BLOQUE ---------------------------------------------------------
            if fmt == 'csv':
                import csv
                import io

                sio = io.StringIO(newline='')
                writer = csv.writer(sio, delimiter=';', quotechar='"', quoting=csv.QUOTE_MINIMAL)

                writer.writerow(['nroDeOrden', 'fecha', 'cliente', 'dispositivo', 'resultado', 'precioTotal', 'empleado'])

                for r in filas:
                    nro = str(r.get('nroDeOrden') or '')
                    fecha = r.get('fecha') or ''
                    cliente = (r.get('cliente_info') or '').replace('\n', ' ').strip()
                    dispositivo = (r.get('dispositivo_info') or '').replace('\n', ' ').strip()
                    resultado = str(r.get('resultado') or r.get('estado') or '').replace('\n', ' ').strip()
                    precio = f"{float(r.get('precioTotal') or 0):.2f}"
                    empleado = (r.get('empleado_info') or '').replace('\n', ' ').strip()

                    writer.writerow([nro, fecha, cliente, dispositivo, resultado, precio, empleado])

                csv_text = '\ufeff' + sio.getvalue()
                data = csv_text.encode('utf-8')

                resp = make_response(data)
                resp.headers['Content-Type'] = 'text/csv; charset=utf-8'
                resp.headers['Content-Disposition'] = 'attachment; filename=reporte_no_reparados.csv'
                return resp
            # ----------------------------------------------------------------------------------------------------

            return jsonify({'summary': summary, 'rows': filas})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Endpoint para dashboard: ingresos y métricas rápidas
@bp.route('/reportes/dashboard', methods=['GET'])
@cross_origin()
def reporte_dashboard():
    """Devuelve KPIs para el dashboard: ingresos diarios/semana/mes, número de órdenes por periodo y tiempo promedio de reparación (días).
    Query params opcionales: ninguno (usa hoy como referencia)."""
    try:
        from ABMC_db import session_scope
        from BDD.database import OrdenDeReparacion, DetalleOrden
        from sqlalchemy import func
        hoy = datetime.now().date()
        # semana: lunes a domingo
        start_week = hoy - timedelta(days=hoy.weekday())
        end_week = start_week + timedelta(days=6)
        # mes: primer día del mes
        start_month = date(hoy.year, hoy.month, 1)

        with session_scope() as s:
            # Ingresos: sumar subtotales de DetalleOrden uniendo con OrdenDeReparacion por nroDeOrden
            ingresos_diarios = s.query(func.coalesce(func.sum(DetalleOrden.subtotal), 0.0)).join(OrdenDeReparacion, DetalleOrden.nroDeOrden == OrdenDeReparacion.nroDeOrden).filter(OrdenDeReparacion.fecha == hoy).scalar() or 0.0
            ingresos_semanales = s.query(func.coalesce(func.sum(DetalleOrden.subtotal), 0.0)).join(OrdenDeReparacion, DetalleOrden.nroDeOrden == OrdenDeReparacion.nroDeOrden).filter(OrdenDeReparacion.fecha >= start_week).filter(OrdenDeReparacion.fecha <= end_week).scalar() or 0.0
            ingresos_mensuales = s.query(func.coalesce(func.sum(DetalleOrden.subtotal), 0.0)).join(OrdenDeReparacion, DetalleOrden.nroDeOrden == OrdenDeReparacion.nroDeOrden).filter(OrdenDeReparacion.fecha >= start_month).scalar() or 0.0

            # Series diarias (últimos 30 días)
            days = 30
            series_dates = []
            series_ingresos = []
            series_ordenes = []
            for i in range(days-1, -1, -1):
                d = hoy - timedelta(days=i)
                series_dates.append(d.isoformat())
                ing = s.query(func.coalesce(func.sum(DetalleOrden.subtotal), 0.0)).join(OrdenDeReparacion, DetalleOrden.nroDeOrden == OrdenDeReparacion.nroDeOrden).filter(OrdenDeReparacion.fecha == d).scalar() or 0.0
                cnt = s.query(func.count(OrdenDeReparacion.nroDeOrden)).filter(OrdenDeReparacion.fecha == d).scalar() or 0
                series_ingresos.append(float(ing))
                series_ordenes.append(int(cnt))

            # Conteo órdenes
            ordenes_diarias = s.query(func.count(OrdenDeReparacion.nroDeOrden)).filter(OrdenDeReparacion.fecha == hoy).scalar() or 0
            ordenes_semanales = s.query(func.count(OrdenDeReparacion.nroDeOrden)).filter(OrdenDeReparacion.fecha >= start_week).filter(OrdenDeReparacion.fecha <= end_week).scalar() or 0
            ordenes_mensuales = s.query(func.count(OrdenDeReparacion.nroDeOrden)).filter(OrdenDeReparacion.fecha >= start_month).scalar() or 0

            # Tiempo promedio de reparación (días) para órdenes con fechaInicioRetiro
            q = s.query(OrdenDeReparacion).filter(OrdenDeReparacion.fecha != None).filter(OrdenDeReparacion.fechaInicioRetiro != None)
            diffs = []
            for o in q.all():
                try:
                    d1 = getattr(o, 'fecha')
                    d2 = getattr(o, 'fechaInicioRetiro')
                    if d1 and d2:
                        diffs.append((d2 - d1).days)
                except Exception:
                    continue
            avg_days = (sum(diffs) / len(diffs)) if diffs else None

        return jsonify({
            'ingresos': {
                'daily': float(ingresos_diarios),
                'weekly': float(ingresos_semanales),
                'monthly': float(ingresos_mensuales)
            },
            'ordenes': {
                'daily': int(ordenes_diarias),
                'weekly': int(ordenes_semanales),
                'monthly': int(ordenes_mensuales)
            },
            'average_repair_time_days': float(avg_days) if avg_days is not None else None,
            'as_of': hoy.isoformat(),
            'series': {
                'dates': series_dates,
                'ingresos': series_ingresos,
                'ordenes': series_ordenes
            }
        }), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
