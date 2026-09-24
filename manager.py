"""
Connection & Room Manager for Asyncio WebSocket Chat
Handles in-memory state, client registration, room broadcasting, and presence updates.
"""

import asyncio
from datetime import datetime
from typing import Dict, Set, Any
from fastapi import WebSocket


class ConnectionManager:
    """
    Manages active WebSocket connections, multi-room memberships,
    presence tracking, and typing indicators using asyncio primitives.
    """

    DEFAULT_ROOMS = [
        {"id": "general", "name": "General Lounge", "desc": "Casual chats & greetings"},
        {"id": "python-dev", "name": "Python & Asyncio", "desc": "Async code, websockets & tips"},
        {"id": "tech-talk", "name": "Tech Talk", "desc": "Architecture, gadgets & software"},
        {"id": "random", "name": "Random", "desc": "Memes, coffee breaks & fun"},
    ]

    def __init__(self):
        # Maps WebSocket -> {"username": str, "room": str, "avatar": str}
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}

        # Maps room_id -> Set of WebSockets
        self.rooms: Dict[str, Set[WebSocket]] = {
            room["id"]: set() for room in self.DEFAULT_ROOMS
        }

        # Room metadata dictionary for dynamic room creation
        self.room_metadata: Dict[str, Dict[str, str]] = {
            room["id"]: {"name": room["name"], "desc": room["desc"]}
            for room in self.DEFAULT_ROOMS
        }

        # Maps room_id -> Set of usernames currently typing
        self.typing_users: Dict[str, Set[str]] = {
            room["id"]: set() for room in self.DEFAULT_ROOMS
        }

    def get_room_info(self, room_id: str) -> Dict[str, Any]:
        """Returns room metadata with current active user count."""
        meta = self.room_metadata.get(
            room_id, {"name": f"#{room_id}", "desc": "Custom Channel"}
        )
        user_count = len(self.rooms.get(room_id, set()))
        return {
            "id": room_id,
            "name": meta["name"],
            "desc": meta["desc"],
            "count": user_count,
        }

    def get_all_rooms_summary(self) -> list[Dict[str, Any]]:
        """Returns summary list of all active or default rooms."""
        return [self.get_room_info(room_id) for room_id in self.room_metadata.keys()]

    def get_room_members(self, room_id: str) -> list[Dict[str, str]]:
        """Returns list of online user dicts (username, avatar) in a given room."""
        members = []
        if room_id in self.rooms:
            for ws in self.rooms[room_id]:
                if ws in self.active_connections:
                    info = self.active_connections[ws]
                    members.append({
                        "username": info["username"],
                        "avatar": info.get("avatar", "🧑‍💻"),
                    })
        return members

    async def connect(self, websocket: WebSocket, username: str, room_id: str, avatar: str = "🧑‍💻"):
        """Accepts WebSocket handshake, assigns user to room, and notifies peers."""
        await websocket.accept()

        if room_id not in self.rooms:
            self.rooms[room_id] = set()
            self.room_metadata[room_id] = {
                "name": f"#{room_id}",
                "desc": "Custom Channel",
            }
            self.typing_users[room_id] = set()

        self.active_connections[websocket] = {
            "username": username,
            "room": room_id,
            "avatar": avatar,
        }
        self.rooms[room_id].add(websocket)

        # 1. Send initial state to the connecting client
        welcome_payload = {
            "type": "init",
            "room": self.get_room_info(room_id),
            "members": self.get_room_members(room_id),
            "all_rooms": self.get_all_rooms_summary(),
        }
        await websocket.send_json(welcome_payload)

        # 2. Broadcast presence update to the room
        await self.broadcast_to_room(
            room_id,
            {
                "type": "presence",
                "event": "join",
                "user": username,
                "room_id": room_id,
                "members": self.get_room_members(room_id),
                "count": len(self.rooms[room_id]),
                "timestamp": datetime.now().strftime("%I:%M %p"),
            },
            exclude=websocket,
        )

        # 3. Broadcast global room list summary to everyone across all rooms
        await self.broadcast_global_room_updates()

    async def disconnect(self, websocket: WebSocket):
        """Cleans up disconnected client and notifies remaining room participants."""
        if websocket not in self.active_connections:
            return

        user_info = self.active_connections.pop(websocket)
        username = user_info["username"]
        room_id = user_info["room"]

        if room_id in self.rooms:
            self.rooms[room_id].discard(websocket)

        # Remove from typing set if they were typing
        if room_id in self.typing_users:
            self.typing_users[room_id].discard(username)

        # Broadcast presence leave to room members
        await self.broadcast_to_room(
            room_id,
            {
                "type": "presence",
                "event": "leave",
                "user": username,
                "room_id": room_id,
                "members": self.get_room_members(room_id),
                "count": len(self.rooms.get(room_id, set())),
                "timestamp": datetime.now().strftime("%I:%M %p"),
            },
        )

        # Broadcast global room list update so user counts refresh for everyone
        await self.broadcast_global_room_updates()

    async def switch_room(self, websocket: WebSocket, new_room_id: str):
        """Moves client from current room to a new room."""
        if websocket not in self.active_connections:
            return

        user_info = self.active_connections[websocket]
        old_room_id = user_info["room"]
        username = user_info["username"]

        if old_room_id == new_room_id:
            return

        # 1. Leave old room
        if old_room_id in self.rooms:
            self.rooms[old_room_id].discard(websocket)
        if old_room_id in self.typing_users:
            self.typing_users[old_room_id].discard(username)

        await self.broadcast_to_room(
            old_room_id,
            {
                "type": "presence",
                "event": "leave",
                "user": username,
                "room_id": old_room_id,
                "members": self.get_room_members(old_room_id),
                "count": len(self.rooms.get(old_room_id, set())),
                "timestamp": datetime.now().strftime("%I:%M %p"),
            },
        )

        # 2. Join new room
        if new_room_id not in self.rooms:
            self.rooms[new_room_id] = set()
            self.room_metadata[new_room_id] = {
                "name": f"#{new_room_id}",
                "desc": "Custom Channel",
            }
            self.typing_users[new_room_id] = set()

        self.rooms[new_room_id].add(websocket)
        user_info["room"] = new_room_id

        # 3. Inform the client about successful switch
        await websocket.send_json({
            "type": "room_switched",
            "room": self.get_room_info(new_room_id),
            "members": self.get_room_members(new_room_id),
        })

        # 4. Notify new room
        await self.broadcast_to_room(
            new_room_id,
            {
                "type": "presence",
                "event": "join",
                "user": username,
                "room_id": new_room_id,
                "members": self.get_room_members(new_room_id),
                "count": len(self.rooms[new_room_id]),
                "timestamp": datetime.now().strftime("%I:%M %p"),
            },
            exclude=websocket,
        )

        # 5. Update global room counts
        await self.broadcast_global_room_updates()

    async def broadcast_to_room(
        self, room_id: str, message: dict, exclude: WebSocket = None
    ):
        """
        Broadcasts a message concurrently to all clients in a specific room using asyncio.gather.
        Stale/broken connections are safely handled without stopping others.
        """
        if room_id not in self.rooms:
            return

        targets = [ws for ws in self.rooms[room_id] if ws != exclude]
        if not targets:
            return

        async def _safe_send(ws: WebSocket):
            try:
                await ws.send_json(message)
            except Exception:
                # Connection dropped or closed abruptly
                pass

        # Concurrently send to all clients in the room
        await asyncio.gather(*[_safe_send(ws) for ws in targets], return_exceptions=True)

    async def broadcast_global_room_updates(self):
        """Broadcasts updated room counts to all connected clients across all rooms."""
        summary = self.get_all_rooms_summary()
        payload = {"type": "rooms_update", "rooms": summary}

        async def _safe_send(ws: WebSocket):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

        all_ws = list(self.active_connections.keys())
        if all_ws:
            await asyncio.gather(*[_safe_send(ws) for ws in all_ws], return_exceptions=True)

    async def set_typing(self, websocket: WebSocket, is_typing: bool):
        """Updates typing presence and broadcasts to room peers."""
        if websocket not in self.active_connections:
            return

        user_info = self.active_connections[websocket]
        room_id = user_info["room"]
        username = user_info["username"]

        if room_id not in self.typing_users:
            self.typing_users[room_id] = set()

        if is_typing:
            self.typing_users[room_id].add(username)
        else:
            self.typing_users[room_id].discard(username)

        typing_list = list(self.typing_users[room_id])
        # Broadcast typing status to everyone else in this room
        await self.broadcast_to_room(
            room_id,
            {
                "type": "typing",
                "room_id": room_id,
                "typing_users": typing_list,
            },
            exclude=websocket,
        )
