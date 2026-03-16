"""
WoL Agent — runs on an always-on device on the same LAN as the target PC.
Receives authenticated HTTP requests from the relay server and sends Wake-on-LAN
magic packets to wake the PC.
"""

import os
import socket
import struct
import logging
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format='[wol-agent] %(levelname)s %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)

TARGET_MAC: str = os.environ.get('TARGET_MAC', '')
BROADCAST_ADDRESS: str = os.environ.get('BROADCAST_ADDRESS', '192.168.1.255')
AGENT_SECRET: str = os.environ.get('AGENT_SECRET', '')
PORT: int = int(os.environ.get('PORT', '3003'))


def build_magic_packet(mac_address: str) -> bytes:
    """Build a WoL magic packet for the given MAC address."""
    # Normalise MAC address — accept colons, dashes, or plain hex
    mac_clean = mac_address.replace(':', '').replace('-', '').replace('.', '')
    if len(mac_clean) != 12:
        raise ValueError(f'Invalid MAC address: {mac_address}')

    mac_bytes = bytes.fromhex(mac_clean)
    # Magic packet: 6x 0xFF followed by 16 repetitions of the MAC address
    return b'\xff' * 6 + mac_bytes * 16


def send_magic_packet(mac_address: str, broadcast: str, wol_port: int = 9) -> None:
    """Send a WoL magic packet via UDP broadcast."""
    packet = build_magic_packet(mac_address)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, (broadcast, wol_port))
    log.info(f'Magic packet sent to {mac_address} via {broadcast}:{wol_port}')


def require_secret(f):
    """Decorator that checks the X-Agent-Secret header."""
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        secret = request.headers.get('X-Agent-Secret', '')
        if not AGENT_SECRET or secret != AGENT_SECRET:
            log.warning('Rejected request: invalid agent secret')
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)

    return decorated


@app.route('/wake', methods=['POST'])
@require_secret
def wake():
    if not TARGET_MAC:
        return jsonify({'error': 'TARGET_MAC not configured'}), 500

    try:
        send_magic_packet(TARGET_MAC, BROADCAST_ADDRESS)
        return jsonify({'message': f'Magic packet sent to {TARGET_MAC}'})
    except Exception as e:
        log.error(f'Failed to send magic packet: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'target_mac': TARGET_MAC or 'not configured',
        'broadcast': BROADCAST_ADDRESS,
    })


if __name__ == '__main__':
    if not TARGET_MAC:
        log.warning('TARGET_MAC is not set — wake requests will fail')
    if not AGENT_SECRET:
        log.warning('AGENT_SECRET is not set — all requests will be rejected')

    log.info(f'WoL agent starting on port {PORT}')
    log.info(f'Target MAC: {TARGET_MAC}')
    log.info(f'Broadcast: {BROADCAST_ADDRESS}')
    app.run(host='0.0.0.0', port=PORT)
