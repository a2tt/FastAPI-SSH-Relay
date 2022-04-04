from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from server.ssh import ssh_connect, ssh_clients
from server.models import User

app = FastAPI()

app.mount('/static', StaticFiles(directory='server/static'), name='static')

templates = Jinja2Templates(directory='server/templates')


@app.get('/', response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse('index.html', {'request': request})


@app.websocket('/ws')
async def websocket_endpoint(websocket: WebSocket,
                             password: str,
                             hostname: str,
                             username: str,
                             port: int = 22):
    # 1. Connect SSH with the passed options
    user = User(user_id=0)
    ssh_worker = ssh_connect(websocket, user, hostname, username, password, port)

    # 2. Accept
    await ssh_worker.accept_websocket()

    # 3. Receive/Send from the user/SSH
    await ssh_worker.run()
