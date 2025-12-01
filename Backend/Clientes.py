import re
from flask import Blueprint, request, jsonify
from ABMC_db import (
    alta_cliente, modificar_cliente, mostrar_clientes, baja_cliente,
    buscar_cliente_por_doc, mostrar_tipos_documento, alta_tipo_documento,
    reactivar_cliente
)
from ABMC_db import dispositivos_por_cliente, mostrar_ordenes, calcular_precio_total_orden_obj, obtener_ordenes

bp = Blueprint('clientes', __name__)

def validar_dni(dni):
    return str(dni).isdigit() and 7 <= len(str(dni)) <= 8

def validar_pasaporte(pasaporte):
    return bool(re.match(r'^[A-Za-z0-9]{6,15}$', str(pasaporte)))

def validar_cuit_cuil(cuit):
    return str(cuit).isdigit() and len(str(cuit)) == 11

def validar_telefono(telefono):
    # Acepta números de 6 a 15 dígitos para soportar diferentes formatos
    # Ejemplos válidos: 351234567 (9 dígitos), 3512345678 (10 dígitos), 
    #                   543513538955 (12 dígitos con código de país 54)
    telefono_limpio = str(telefono).strip()
    return telefono_limpio.isdigit() and 6 <= len(telefono_limpio) <= 15

def validar_email(email):
    return bool(re.match(r'^[^@]+@[^@]+\.[^@]+$', str(email)))

@bp.route("/clientes", methods=["POST"])
def registrar_cliente():
    data = request.get_json() or {}
    idTipoDoc = data.get("idTipoDoc")
    numeroDoc = data.get("numeroDoc")
    nombre = data.get("nombre")
    apellido = data.get("apellido")
    telefono = data.get("telefono")
    mail = data.get("mail")
    activo = data.get("activo", 1)

    print("Datos recibidos:", data)

    if not idTipoDoc or not numeroDoc or not nombre or not apellido:
        return jsonify({"error": "Faltan campos obligatorios"}), 400
    # Validaciones adicionales si es necesario
    if telefono and not validar_telefono(telefono):
        return jsonify({"error": "Teléfono inválido"}), 400
    if mail and not validar_email(mail):
        return jsonify({"error": "Email inválido"}), 400

    # Verificar duplicados: mismo tipo+numero de documento
    existente = buscar_cliente_por_doc(idTipoDoc, numeroDoc)
    if existente:
        return jsonify({"error": "Ya existe un cliente con el mismo tipo y número de documento"}), 400

    try:
        cliente = alta_cliente(
            idTipoDoc=idTipoDoc,
            numeroDoc=numeroDoc,
            nombre=nombre,
            apellido=apellido,
            telefono=telefono,
            mail=mail,
            activo=activo
        )
        return jsonify({
            'idCliente': cliente.idCliente,
            'idTipoDoc': cliente.idTipoDoc,
            'numeroDoc': cliente.numeroDoc,
            'nombre': cliente.nombre,
            'apellido': cliente.apellido,
            'telefono': cliente.telefono,
            'mail': cliente.mail,
            'activo': cliente.activo
        }), 201
    except Exception as e:
        import traceback
        print("Error al crear cliente:")
        print(traceback.format_exc())
        return jsonify({"error": "No se pudo crear cliente", "detail": str(e)}), 500

@bp.route("/clientes", methods=["GET"])
def listar_clientes():
    activos = request.args.get('activos', 'true')
    search = request.args.get('search', None)
    if activos == 'true':
        clientes = mostrar_clientes(activos_only=True, search=search)
    else:
        clientes = [c for c in mostrar_clientes(activos_only=False, search=search) if not c.activo]
    return jsonify([
        {
            'idCliente': c.idCliente,
            'idTipoDoc': c.idTipoDoc,
            'numeroDoc': c.numeroDoc,
            'nombre': c.nombre,
            'apellido': c.apellido,
            'telefono': c.telefono,
            'mail': c.mail,
            'activo': c.activo
        } for c in clientes
    ])

@bp.route("/clientes/<int:idCliente>", methods=["PUT"])
def modificar_datos_cliente(idCliente):
    data = request.get_json()
    # Si se intentan cambiar idTipoDoc/numeroDoc verificar duplicado en otro cliente
    new_idTipoDoc = data.get('idTipoDoc')
    new_numeroDoc = data.get('numeroDoc')
    if new_idTipoDoc and new_numeroDoc:
        existente = buscar_cliente_por_doc(new_idTipoDoc, new_numeroDoc)
        if existente and existente.idCliente != idCliente:
            return jsonify({"error": "Otro cliente ya tiene ese tipo y número de documento"}), 400
    cliente = modificar_cliente(
        idCliente=idCliente,
        idTipoDoc=data.get('idTipoDoc'),
        numeroDoc=data.get('numeroDoc'),
        nombre=data.get('nombre'),
        apellido=data.get('apellido'),
        telefono=data.get('telefono'),
        mail=data.get('mail'),
        activo=data.get('activo')
    )
    if cliente:
        return jsonify({'success': True})
    return jsonify({'error': 'Cliente no encontrado'}), 404


@bp.route('/clientes/existe', methods=['GET'])
def cliente_existe():
    idTipoDoc = request.args.get('idTipoDoc')
    numeroDoc = request.args.get('numeroDoc')
    if not idTipoDoc or not numeroDoc:
        return jsonify({'error': 'Faltan parámetros'}), 400
    existe = True if buscar_cliente_por_doc(idTipoDoc, numeroDoc) else False
    return jsonify({'exists': existe})


@bp.route("/clientes/<int:idCliente>", methods=["DELETE"])
def eliminar_cliente(idCliente):
    # Verificar si el cliente tiene órdenes activas
    ordenes = obtener_ordenes(mode='summary', idCliente=idCliente) or []
    ordenes_activas = [o for o in ordenes if o.get('estado', '').lower() not in ['retirado', 'abandonado']]
    if ordenes_activas:
        return jsonify({'error': 'No se puede eliminar el cliente porque está asociado a una orden activa.'}), 400
    cliente = baja_cliente(idCliente)
    if cliente:
        return jsonify({'success': True})
    return jsonify({'error': 'Cliente no encontrado'}), 404

@bp.route("/clientes/<int:idCliente>/reactivar", methods=["PUT"])
def reactivar_cliente_endpoint(idCliente):
    cliente = reactivar_cliente(idCliente)
    if cliente:
        return jsonify({'success': True})
    return jsonify({'error': 'Cliente no encontrado'}), 404

@bp.route("/tipos-documento", methods=["GET"])
def listar_tipos_documento():
    tipos = mostrar_tipos_documento()
    return jsonify([
        {'idTipoDoc': t.idTipoDoc, 'nombre': t.nombre}
        for t in tipos
    ])


@bp.route('/clientes/<int:idCliente>/historial-ordenes', methods=['GET'])
def historial_ordenes_por_cliente(idCliente):
    """Devuelve el historial de órdenes de reparación para todos los dispositivos de un cliente.

    Respuesta: lista de objetos con: nroDeOrden, fecha, dispositivo (marca/modelo/nroSerie), diagnostico, precioTotal
    """
    try:
        # Usar la función centralizada para obtener órdenes por cliente
        resultado = obtener_ordenes(mode='summary', idCliente=idCliente)
        return jsonify(resultado or [])
    except Exception as e:
        return jsonify({'error': 'No se pudo obtener el historial', 'detail': str(e)}), 500