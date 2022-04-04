from __future__ import annotations

import json
import asyncio
from enum import Enum
from typing import Dict, Set, Awaitable
from collections import defaultdict

import paramiko
from paramiko import (
    SSHClient,
    AutoAddPolicy,
)
from paramiko.channel import Channel
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from server.models import User, ConnectionInfo

MAX_SSH_CONNECTION = 5  # Maximum number of SSH connection per user
ssh_clients: Dict[str, Set[SSHWorker]] = defaultdict(set)  # (user-id, ip): {ssh-worker1, ...}


class SSHStopRetry(Exception):
    pass

class WorkerStatus(Enum):
    DISCONNECTED = 0
    CONNECTING = 1  # Not used
    CONNECTED = 2


class Reason:
    SSH_TOO_MANY = 'You are trying to connection too many connection'
    SSH_AUTH_FAIL = 'Cannot connect to the SSH server. Authentication failed.'
    SSH_FAIL = 'Cannot connect to the SSH server.'
    SSH_DOWN = 'SSH server down'
    SSH_CHAN_CLOSE = 'SSH channel closed'

    SERVER_DOWN = 'Server down'  # Normally on KeyboardInterrupt
    WS_DISCONNECTED = 'Websocket disconnected'


class SSHWorker:
    """
    The websocket connection from clients can be disconnected unintentionally.
    Thus, it would be more comfortable to users to keep ``SSHWorker`` alive and recycle
    it for the next connection.

    TODO: delete idle instance after n seconds of disconnection, and remove from ssh_clients map.
    """

    BUF_SIZE = 32 * 1024

    def __init__(self, websocket: WebSocket, connection_info: ConnectionInfo, client: SSHClient):
        self.websocket: WebSocket = websocket
        self.connection_info: ConnectionInfo = connection_info

        self.client: SSHClient = client
        self.channel: Channel | None = None
        self.ssh_retry = 5
        self.set_ssh_channel()

        self.status: WorkerStatus = WorkerStatus.DISCONNECTED
        self.awaitable_recv_client: asyncio.tasks.Task | None = None
        self.awaitable_recv_ssh: asyncio.tasks.Task | None = None

    @property
    def is_connected(self):
        return self.status == WorkerStatus.CONNECTED

    def set_ssh_channel(self):
        """
        Create ``paramiko.channel`` instance that might be closed in the middle
        of receiving messages
        """

        if not (self.channel is None or self.channel.closed):
            return

        try:
            self.channel = self.client.invoke_shell()
        except paramiko.SSHException:
            self.cleanup(Reason.SSH_DOWN, True)
            self.ssh_retry -= 1

            if self.ssh_retry < 0:
                raise SSHStopRetry
            raise IOError

    def setup_recycle(self, websocket: WebSocket, connection_info: ConnectionInfo):
        """ setup variables for the next websocket user """

        self.websocket = websocket
        self.connection_info = connection_info
        self.channel.sendall(b'\f')

    async def run(self):
        self.set_awaitable_task(self.recv_from_client(), self.recv_from_ssh())

        try:
            await asyncio.gather(
                self.awaitable_recv_client,
                self.awaitable_recv_ssh,
            )
        except asyncio.CancelledError:
            return

    def set_awaitable_task(self, recv_client: Awaitable, recv_ssh: Awaitable):
        self.awaitable_recv_client = asyncio.create_task(recv_client)
        self.awaitable_recv_ssh = asyncio.create_task(recv_ssh)

    async def accept_websocket(self):
        await self.websocket.accept()
        self.status = WorkerStatus.CONNECTED

    async def cleanup(self, reason: str, send_close: bool):
        if send_close and self.websocket.application_state == WebSocketState.CONNECTED:
            data = {'event': 'CLOSE', 'reason': reason}
            await self.websocket.send_bytes(json.dumps(data).encode())
            await self.websocket.close()

        self.status = WorkerStatus.DISCONNECTED

    async def recv_from_client(self):
        """
        Receive message from the client(browser) and forward that messages to
        the SSH server
        """

        reason = ''
        send_close = True
        while self.is_connected:
            try:
                self.set_ssh_channel()

                # Receive from client
                data = await self.websocket.receive_text()
                print(f'from client ({self.connection_info})', data)

                # Forward to SSH server
                msg = json.loads(data)['data']
                self.channel.sendall(msg)
            except KeyboardInterrupt:
                reason = Reason.SERVER_DOWN
                break
            except IOError:
                continue
            except WebSocketDisconnect:
                reason = Reason.WS_DISCONNECTED
                send_close = False
                break
            except:
                break

        await self.cleanup(reason, send_close)
        if not self.awaitable_recv_ssh.done():
            self.awaitable_recv_ssh.cancel(reason)

    async def recv_from_ssh(self):
        """
        Receive message from SSH server and forward that messages to the
        client(browser)
        """

        reason = ''
        send_close = True
        while self.is_connected:
            await asyncio.sleep(0.01)
            try:
                self.set_ssh_channel()

                data = self.channel.recv(self.BUF_SIZE)
                if len(data) <= 0:
                    continue

                await self.websocket.send_bytes(data)
            except KeyboardInterrupt:
                reason = Reason.SERVER_DOWN
                break
            except (OSError, IOError):
                # including socket.timeout
                continue
            except WebSocketDisconnect:
                reason = Reason.WS_DISCONNECTED
                send_close = False
                break
            except:
                break

        await self.cleanup(reason, send_close)


def ssh_connect(
    websocket: WebSocket,
    user: User,
    hostname: str,
    username: str,
    password: str,
    port: int = 22
):
    if len(ssh_clients[str(user)]) > MAX_SSH_CONNECTION:
        raise Exception(Reason.SSH_TOO_MANY)

    # When there is already connected ssh client disconnected with the user,
    # reuse that ssh client.
    connection_info = ConnectionInfo(user=user, ssh_user=username,
                                     src=websocket.client.host, dest=hostname,
                                     port=port)

    for worker in ssh_clients[connection_info.key]:
        if worker.status == WorkerStatus.DISCONNECTED:
            worker.setup_recycle(websocket, connection_info)
            return worker

    client = SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(AutoAddPolicy)

    try:
        client.connect(hostname=hostname,
                       username=username,
                       password=password,
                       port=port,
                       compress=True,
                       )

    except paramiko.AuthenticationException:
        raise Exception(Reason.SSH_AUTH_FAIL)
    except Exception as e:
        raise Exception(Reason.SSH_FAIL)

    ssh_worker = SSHWorker(websocket, connection_info, client)
    ssh_worker.channel.settimeout(0)

    ssh_clients[connection_info.key].add(ssh_worker)
    return ssh_worker
