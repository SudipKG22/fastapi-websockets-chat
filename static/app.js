/**
 * WhatsApp Real-Time Multi-Room Chat Client
 * Connects to FastAPI Asyncio WebSocket Backend
 */

// Application State
const state = {
  username: "",
  avatar: "🧑‍💻",
  currentRoom: { id: "general", name: "General Lounge", desc: "Casual chats & greetings" },
  rooms: [],
  members: [],
  socket: null,
  isTyping: false,
  typingTimer: null,
  heartbeatTimer: null,
  theme: localStorage.getItem("chat_theme") || "light",
};

// DOM Elements
const elements = {
  loginModal: document.getElementById("loginModal"),
  loginForm: document.getElementById("loginForm"),
  usernameInput: document.getElementById("usernameInput"),
  avatarOptions: document.querySelectorAll(".avatar-option"),
  
  myNameDisplay: document.getElementById("myNameDisplay"),
  myAvatarDisplay: document.getElementById("myAvatarDisplay"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),

  roomsList: document.getElementById("roomsList"),
  roomSearchInput: document.getElementById("roomSearchInput"),
  btnNewRoom: document.getElementById("btnNewRoom"),

  currentRoomName: document.getElementById("currentRoomName"),
  currentRoomAvatar: document.getElementById("currentRoomAvatar"),
  roomDesc: document.getElementById("roomDesc"),
  activeCountBadge: document.getElementById("activeCountBadge"),
  typingSubtitle: document.getElementById("typingSubtitle"),

  messagesContainer: document.getElementById("messagesContainer"),
  chatForm: document.getElementById("chatForm"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),

  btnEmojiToggle: document.getElementById("btnEmojiToggle"),
  emojiPicker: document.getElementById("emojiPicker"),

  btnToggleMembers: document.getElementById("btnToggleMembers"),
  membersBtnText: document.getElementById("membersBtnText"),
  membersDrawer: document.getElementById("membersDrawer"),
  btnCloseDrawer: document.getElementById("btnCloseDrawer"),
  membersList: document.getElementById("membersList"),

  newRoomModal: document.getElementById("newRoomModal"),
  newRoomForm: document.getElementById("newRoomForm"),
  customRoomId: document.getElementById("customRoomId"),
  btnCancelRoom: document.getElementById("btnCancelRoom"),
};

/* ==========================================================================
   Sound Notifications (Web Audio API Synthesizer - Zero External Files)
   ========================================================================== */
function playChime(type = "message") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "message") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "join") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (e) {
    // AudioContext blocked until first user gesture
  }
}

/* ==========================================================================
   Theme Management
   ========================================================================== */
function applyTheme(theme) {
  state.theme = theme;
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    elements.themeToggleBtn.textContent = "☀️";
  } else {
    document.documentElement.removeAttribute("data-theme");
    elements.themeToggleBtn.textContent = "🌓";
  }
  localStorage.setItem("chat_theme", theme);
}

elements.themeToggleBtn.addEventListener("click", () => {
  applyTheme(state.theme === "dark" ? "light" : "dark");
});
applyTheme(state.theme);

/* ==========================================================================
   Login & Avatar Selection
   ========================================================================== */
elements.avatarOptions.forEach((btn) => {
  btn.addEventListener("click", () => {
    elements.avatarOptions.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    state.avatar = btn.getAttribute("data-avatar");
  });
});

elements.loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const username = elements.usernameInput.value.trim();
  if (!username) return;

  state.username = username;
  elements.myNameDisplay.textContent = username;
  elements.myAvatarDisplay.textContent = state.avatar;
  elements.loginModal.classList.add("hidden");

  // Initialize WebSocket connection
  connectWebSocket();
});

/* ==========================================================================
   WebSocket Lifecycle (Connecting to FastAPI Backend)
   ========================================================================== */
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host || "127.0.0.1:8000";
  const wsUrl = `${protocol}//${host}/ws?username=${encodeURIComponent(state.username)}&room=${encodeURIComponent(state.currentRoom.id)}&avatar=${encodeURIComponent(state.avatar)}`;

  state.socket = new WebSocket(wsUrl);

  state.socket.onopen = () => {
    console.log("WebSocket connection established with FastAPI Asyncio backend");
    startHeartbeat();
  };

  state.socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  };

  state.socket.onclose = (event) => {
    console.warn("WebSocket closed. Reconnecting in 3 seconds...", event);
    stopHeartbeat();
    renderSystemPill("Disconnected from server. Reconnecting...");
    setTimeout(() => {
      if (!elements.loginModal.classList.contains("hidden")) return;
      connectWebSocket();
    }, 3000);
  };

  state.socket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
}

function startHeartbeat() {
  stopHeartbeat();
  state.heartbeatTimer = setInterval(() => {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: "ping" }));
    }
  }, 25000);
}

function stopHeartbeat() {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
}

/* ==========================================================================
   Server Event Handlers
   ========================================================================== */
function handleServerEvent(data) {
  switch (data.type) {
    case "init":
      state.currentRoom = data.room;
      state.members = data.members;
      state.rooms = data.all_rooms;
      updateRoomUI();
      renderRoomsList();
      renderMembersDrawer();
      renderSystemPill(`You joined #${state.currentRoom.id}`);
      break;

    case "chat":
      renderChatMessage(data);
      if (data.sender !== state.username) {
        playChime("message");
      }
      break;

    case "presence":
      state.members = data.members;
      updateActiveCount(data.count);
      renderMembersDrawer();
      const actionWord = data.event === "join" ? "joined" : "left";
      renderSystemPill(`${escapeHtml(data.user)} ${actionWord} the room`);
      if (data.event === "join") playChime("join");
      break;

    case "typing":
      handleTypingStatus(data.typing_users || []);
      break;

    case "rooms_update":
      state.rooms = data.rooms;
      renderRoomsList();
      break;

    case "room_switched":
      state.currentRoom = data.room;
      state.members = data.members;
      updateRoomUI();
      renderMembersDrawer();
      clearMessages();
      renderSystemPill(`Switched to #${state.currentRoom.id}`);
      break;

    case "pong":
      // Heartbeat acknowledged
      break;

    default:
      console.log("Unhandled event:", data);
  }
}

/* ==========================================================================
   UI Rendering Functions
   ========================================================================== */
function updateRoomUI() {
  elements.currentRoomName.textContent = state.currentRoom.name;
  elements.currentRoomAvatar.textContent = state.currentRoom.name.charAt(0).toUpperCase();
  elements.roomDesc.textContent = state.currentRoom.desc || `Channel #${state.currentRoom.id}`;
  updateActiveCount(state.members.length);
}

function updateActiveCount(count) {
  const label = `${count} ${count === 1 ? "member" : "members"}`;
  elements.activeCountBadge.textContent = label;
  elements.membersBtnText.textContent = `Members (${count})`;
}

function renderRoomsList() {
  const filter = (elements.roomSearchInput.value || "").toLowerCase().trim();
  elements.roomsList.innerHTML = "";

  const filtered = state.rooms.filter(
    (r) => r.name.toLowerCase().includes(filter) || r.id.toLowerCase().includes(filter)
  );

  filtered.forEach((room) => {
    const isActive = room.id === state.currentRoom.id;
    const card = document.createElement("div");
    card.className = `room-card ${isActive ? "active" : ""}`;
    card.innerHTML = `
      <div class="room-icon-avatar">#</div>
      <div class="room-info">
        <div class="room-top">
          <span class="room-name-text">${escapeHtml(room.name)}</span>
          <span class="online-badge-count">${room.count}</span>
        </div>
        <div class="room-desc-text">${escapeHtml(room.desc || '#' + room.id)}</div>
      </div>
    `;

    card.addEventListener("click", () => {
      if (room.id !== state.currentRoom.id) {
        switchRoom(room.id);
      }
    });

    elements.roomsList.appendChild(card);
  });
}

function renderMembersDrawer() {
  elements.membersList.innerHTML = "";
  state.members.forEach((m) => {
    const isMe = m.username === state.username;
    const div = document.createElement("div");
    div.className = "member-item";
    div.innerHTML = `
      <span class="member-avatar">${m.avatar || "🧑‍💻"}</span>
      <span class="member-name">${escapeHtml(m.username)}</span>
      ${isMe ? '<span class="member-you-tag">YOU</span>' : ''}
    `;
    elements.membersList.appendChild(div);
  });
}

function renderChatMessage(data) {
  const isMe = data.sender === state.username;
  const colorIndex = Math.abs(hashString(data.sender)) % 5 + 1;

  const row = document.createElement("div");
  row.className = `message-row ${isMe ? "outgoing" : "incoming"}`;

  const avatarHtml = `<div class="msg-avatar">${data.avatar || "🧑‍💻"}</div>`;
  const senderHeader = !isMe ? `<div class="sender-name c${colorIndex}">${escapeHtml(data.sender)}</div>` : "";
  const tickMark = isMe ? '<span class="double-tick">✓✓</span>' : '';

  row.innerHTML = `
    ${avatarHtml}
    <div class="message-bubble">
      ${senderHeader}
      <div class="message-content">${escapeHtml(data.text)}</div>
      <div class="message-meta">
        <span class="msg-time">${data.timestamp || ""}</span>
        ${tickMark}
      </div>
    </div>
  `;

  elements.messagesContainer.appendChild(row);
  scrollToBottom();
}

function renderSystemPill(text) {
  const pill = document.createElement("div");
  pill.className = "system-event-pill";
  pill.textContent = text;
  elements.messagesContainer.appendChild(pill);
  scrollToBottom();
}

function clearMessages() {
  elements.messagesContainer.innerHTML = `
    <div class="chat-date-separator">
      <span>TODAY</span>
    </div>
  `;
}

function scrollToBottom() {
  elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function handleTypingStatus(typingUsers) {
  // Filter out myself
  const others = typingUsers.filter((u) => u !== state.username);
  if (others.length === 0) {
    elements.typingSubtitle.innerHTML = `<span id="roomDesc">${escapeHtml(state.currentRoom.desc)}</span>`;
  } else {
    const names = others.join(", ");
    const verb = others.length === 1 ? "is" : "are";
    elements.typingSubtitle.innerHTML = `<span class="typing-active">✍️ ${escapeHtml(names)} ${verb} typing...</span>`;
  }
}

/* ==========================================================================
   User Actions: Send Message, Typing Indicator, Switch Room
   ========================================================================== */
function sendMessage() {
  const text = elements.messageInput.value.trim();
  if (!text || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;

  state.socket.send(
    JSON.stringify({
      type: "chat",
      text: text,
    })
  );

  elements.messageInput.value = "";
  sendTypingStatus(false);
  elements.messageInput.focus();
}

function switchRoom(roomId) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(
    JSON.stringify({
      type: "switch_room",
      room_id: roomId,
    })
  );
}

function sendTypingStatus(isTyping) {
  if (state.isTyping === isTyping) return;
  state.isTyping = isTyping;

  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(
      JSON.stringify({
        type: "typing",
        is_typing: isTyping,
      })
    );
  }
}

// Input Event Listeners for Debounced Typing
elements.messageInput.addEventListener("input", () => {
  sendTypingStatus(true);
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    sendTypingStatus(false);
  }, 1500);
});

elements.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage();
});

/* ==========================================================================
   Emoji Picker & Modals
   ========================================================================== */
elements.btnEmojiToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  elements.emojiPicker.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  elements.emojiPicker.classList.add("hidden");
});

elements.emojiPicker.querySelectorAll("span").forEach((span) => {
  span.addEventListener("click", () => {
    elements.messageInput.value += span.textContent;
    elements.messageInput.focus();
  });
});

// Member Drawer Toggle
elements.btnToggleMembers.addEventListener("click", () => {
  elements.membersDrawer.classList.toggle("hidden");
});
elements.btnCloseDrawer.addEventListener("click", () => {
  elements.membersDrawer.classList.add("hidden");
});

// Search Filter
elements.roomSearchInput.addEventListener("input", renderRoomsList);

// Custom Room Creation Modal
elements.btnNewRoom.addEventListener("click", () => {
  elements.customRoomId.value = "";
  elements.newRoomModal.classList.remove("hidden");
  elements.customRoomId.focus();
});

elements.btnCancelRoom.addEventListener("click", () => {
  elements.newRoomModal.classList.add("hidden");
});

elements.newRoomForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const rawId = elements.customRoomId.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  if (!rawId) return;

  elements.newRoomModal.classList.add("hidden");
  switchRoom(rawId);
});

/* ==========================================================================
   Utility Helpers
   ========================================================================== */
function escapeHtml(str) {
  if (!str) return "";
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(str).replace(/[&<>"']/g, (m) => map[m]);
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
