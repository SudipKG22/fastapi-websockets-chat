"""
Main FastAPI server for Real-Time Multi-Room Chat with Presence.
Handles HTTP static file serving and WebSocket routing with Asyncio.
"""

from datetime import datetime
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn

from manager import ConnectionManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="WhatsApp-style Real-Time Chat (Asyncio + WebSockets)")
manager = ConnectionManager()

# Serve static files (HTML, CSS, JS, Assets)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def get_index():
    """Serves the WhatsApp-styled Single Page Application."""
    return FileResponse("static/index.html")


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    username: str = Query(..., min_length=1, max_length=30),
    room: str = Query(default="general", min_length=1, max_length=30),
    avatar: str = Query(default="🧑‍💻"),
):
    """
    WebSocket endpoint handling client lifecycles:
    - Connection handshake & registration
    - Message routing (chat, switch_room, typing, ping)
    - Clean disconnection & presence broadcasts
    """
    await manager.connect(websocket, username=username, room_id=room, avatar=avatar)
    logger.info(f"User '{username}' connected to room '{room}' with avatar '{avatar}'")

    try:
        while True:
            # Receive raw text message from WebSocket client
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            # 1. Chat Message
            if msg_type == "chat":
                text = (data.get("text") or "").strip()
                if not text:
                    continue

                user_info = manager.active_connections.get(websocket, {})
                current_room = user_info.get("room", room)
                sender = user_info.get("username", username)
                sender_avatar = user_info.get("avatar", avatar)
                timestamp = datetime.now().strftime("%I:%M %p")

                payload = {
                    "type": "chat",
                    "sender": sender,
                    "avatar": sender_avatar,
                    "text": text,
                    "room_id": current_room,
                    "timestamp": timestamp,
                }
                # Broadcast message to everyone in the room
                await manager.broadcast_to_room(current_room, payload)

            # 2. Room Switch
            elif msg_type == "switch_room":
                new_room = data.get("room_id", "general")
                await manager.switch_room(websocket, new_room)

            # 3. Typing Indicator
            elif msg_type == "typing":
                is_typing = bool(data.get("is_typing", False))
                await manager.set_typing(websocket, is_typing)

            # 4. Heartbeat / Ping-Pong (Keeps connection active)
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        logger.info(f"User '{username}' disconnected.")
        await manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Unexpected error for user '{username}': {e}")
        await manager.disconnect(websocket)


if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
