import requests
import json
from typing import Optional

# Configuración de WhatsApp Cloud API (proporcionada por el usuario)
ACCESS_TOKEN = "EAAYVIOY7h0UBQOVIV6pXm3yg2VZCMPe8YIPyNeHSJNbJehzQ7IFvaEZCQJSApen9YhvsODUwZAYDY7gfI02PIV8TOu4EUHqlZBTFhQ6a6oMDprCKf2vMAv3LHYDD6BQdi46BGf4vzKgpchdZAzAEdEPa55qxdt9ar7khN6JGKZAOLwS7rbSvCOw2VLyC1wRyR494H6bEDdbWliOsoXLeHS0bXZBdkmmdwJCEqaFtm9tJZChnTidFpLpzGLVMjlNtGJXZBJwj8vQqepI7psTQN9iPgkhtLxRUZD"
PHONE_NUMBER_ID = "814465951747653"


def upload_to_transfersh(file_bytes: bytes, filename: str) -> str:
    """
    Sube bytes a transfer.sh y devuelve la URL pública.
    Requiere que transfer.sh esté disponible y accesible desde el servidor.
    """
    # transfer.sh permite uploads via curl: curl --upload-file ./file.zip https://transfer.sh/file.zip
    # Aquí hacemos lo equivalente con requests
    upload_url = f"https://transfer.sh/{filename}"
    headers = { 'Max-Downloads': '10' }
    resp = requests.put(upload_url, data=file_bytes, headers=headers)
    if resp.status_code in (200, 201):
        return resp.text.strip()
    else:
        raise RuntimeError(f"Transfer.sh upload failed: {resp.status_code} - {resp.text}")


def _upload_media_to_whatsapp_by_url(media_url: str, mime_type: str = 'application/pdf') -> dict:
    """
    Registra un media en WhatsApp Cloud API usando un link público (media_url).
    Devuelve el JSON de respuesta que contiene 'id' del media.
    """
    if ACCESS_TOKEN.startswith('REPLACE') or PHONE_NUMBER_ID.startswith('REPLACE'):
        raise RuntimeError('ACCESS_TOKEN and PHONE_NUMBER_ID must be configured in whatsapp.py')

    url = f"https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/media"
    params = {'access_token': ACCESS_TOKEN}
    # WhatsApp Cloud API permite enviar un 'file' param que apunte a una URL pública
    data = {
        'messaging_product': 'whatsapp',
        'type': 'document',
        'file_url': media_url,
        'mime_type': mime_type
    }
    # Algunos endpoints requieren multipart/form-data; aquí intentamos POST con JSON
    resp = requests.post(url, params=params, data=data)
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"WhatsApp media upload failed: {resp.status_code} - {resp.text}")
    return resp.json()


def upload_media_bytes_to_whatsapp(file_bytes: bytes, filename: str, mime_type: str = 'application/pdf') -> dict:
    """
    Sube directamente bytes al endpoint /{phone-number-id}/media de WhatsApp Cloud API
    usando multipart/form-data y devuelve la respuesta JSON (contiene 'id').
    """
    if ACCESS_TOKEN.startswith('REPLACE') or PHONE_NUMBER_ID.startswith('REPLACE'):
        raise RuntimeError('ACCESS_TOKEN and PHONE_NUMBER_ID must be configured in whatsapp.py')

    url = f"https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/media"
    params = {'access_token': ACCESS_TOKEN}
    files = {
        'file': (filename, file_bytes, mime_type)
    }
    data = {
        'messaging_product': 'whatsapp'
    }
    resp = requests.post(url, params=params, files=files, data=data)
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"WhatsApp media upload (bytes) failed: {resp.status_code} - {resp.text}")
    return resp.json()


def enviar_whatsapp_pdf_bytes(pdf_bytes: bytes, nroDeOrden: int, destinatario: str, caption: Optional[str] = None, filename: Optional[str] = None) -> dict:
    """
    Envía un PDF por WhatsApp subiendo directamente los bytes al endpoint de media.
    Devuelve la respuesta del envío.
    """
    if not filename:
        filename = f'Comprobante_Orden_{nroDeOrden}.pdf'

    # 1) subir bytes a WhatsApp
    media_resp = upload_media_bytes_to_whatsapp(pdf_bytes, filename, mime_type='application/pdf')
    media_id = media_resp.get('id')
    if not media_id:
        raise RuntimeError(f'No media id returned by WhatsApp (bytes): {media_resp}')

    # 2) enviar mensaje tipo document
    send_url = f"https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages"
    headers = {
        'Authorization': f'Bearer {ACCESS_TOKEN}',
        'Content-Type': 'application/json'
    }
    body = {
        'messaging_product': 'whatsapp',
        'to': destinatario,
        'type': 'document',
        'document': {
            'id': media_id,
            'caption': caption or f'Comprobante Orden {nroDeOrden}',
            'filename': filename
        }
    }
    resp = requests.post(send_url, headers=headers, json=body)
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"Error sending WhatsApp message (bytes): {resp.status_code} - {resp.text}")
    return resp.json()


def enviar_whatsapp_pdf(pdf_url: str, nroDeOrden: int, destinatario: str, caption: Optional[str] = None, filename: Optional[str] = None) -> dict:
    """
    Envía un documento PDF por WhatsApp Cloud API.
    Flujo:
      1) Registrar el media en la API de WhatsApp usando el link público (pdf_url)
      2) Enviar un mensaje tipo 'document' referenciando el media id obtenido

    Devuelve el JSON que la API responda al enviar el mensaje.
    """
    if ACCESS_TOKEN.startswith('REPLACE') or PHONE_NUMBER_ID.startswith('REPLACE'):
        raise RuntimeError('ACCESS_TOKEN and PHONE_NUMBER_ID must be configured in whatsapp.py')

    # 1) subir/registrar media en WhatsApp mediante URL
    media_resp = _upload_media_to_whatsapp_by_url(pdf_url, mime_type='application/pdf')
    media_id = media_resp.get('id')
    if not media_id:
        raise RuntimeError(f'No media id returned by WhatsApp: {media_resp}')

    # 2) enviar mensaje tipo document
    send_url = f"https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages"
    headers = {
        'Authorization': f'Bearer {ACCESS_TOKEN}',
        'Content-Type': 'application/json'
    }

    body = {
        'messaging_product': 'whatsapp',
        'to': destinatario,
        'type': 'document',
        'document': {
            'id': media_id,
            'caption': caption or f'Comprobante Orden {nroDeOrden}',
            'filename': filename or f'Comprobante_Orden_{nroDeOrden}.pdf'
        }
    }

    resp = requests.post(send_url, headers=headers, json=body)
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"Error sending WhatsApp message: {resp.status_code} - {resp.text}")
    return resp.json()


if __name__ == '__main__':
    print('Este módulo expone helpers: upload_to_transfersh(file_bytes, filename) y enviar_whatsapp_pdf(pdf_url, nroDeOrden, destinatario)')
    

def send_text(destinatario: str, texto: str) -> dict:
    """Envía un mensaje de texto simple usando la WhatsApp Cloud API (v22.0)."""
    url = f"https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages"
    headers = {
        'Authorization': f'Bearer {ACCESS_TOKEN}',
        'Content-Type': 'application/json'
    }
    payload = {
        'messaging_product': 'whatsapp',
        'to': destinatario,
        'type': 'text',
        'text': { 'body': texto }
    }
    resp = requests.post(url, headers=headers, json=payload)
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"Error sending text message: {resp.status_code} - {resp.text}")
    return resp.json()


def send_template(destinatario: str, template_name: str, language_code: str = 'en_US', components: Optional[list] = None) -> dict:
    """Envía un template message.
    `components` si se provee debe ser una lista conforme al spec de WhatsApp (botones, body params, etc.).
    """
    url = f"https://graph.facebook.com/v22.0/{PHONE_NUMBER_ID}/messages"
    headers = {
        'Authorization': f'Bearer {ACCESS_TOKEN}',
        'Content-Type': 'application/json'
    }
    payload = {
        'messaging_product': 'whatsapp',
        'to': destinatario,
        'type': 'template',
        'template': {
            'name': template_name,
            'language': { 'code': language_code }
        }
    }
    if components:
        payload['template']['components'] = components

    resp = requests.post(url, headers=headers, json=payload)
    if resp.status_code // 100 != 2:
        raise RuntimeError(f"Error sending template message: {resp.status_code} - {resp.text}")
    return resp.json()
