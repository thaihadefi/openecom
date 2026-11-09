const fmtTime = (date) => {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleTimeString((window.storeLocale && window.storeLocale.locale) || undefined, { hour: "2-digit", minute: "2-digit" });
};

const fmtDateDivider = (date) => {
  const d = date ? new Date(date) : new Date();
  const now = new Date();
  const isToday = d.getDate() === now.getDate() &&
                  d.getMonth() === now.getMonth() &&
                  d.getFullYear() === now.getFullYear();
  if (isToday) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() &&
                      d.getMonth() === yesterday.getMonth() &&
                      d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return "Yesterday";

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const updateDateDividers = () => {
  const chatDetail = document.querySelector(".chat-detail");
  if (!chatDetail) return;
  chatDetail.querySelectorAll(".chat-date-divider").forEach(el => el.remove());

  const messages = chatDetail.querySelectorAll(".d-flex[id]");
  let lastDateVal = null;

  messages.forEach(msgEl => {
    const timeAttr = msgEl.getAttribute("data-time");
    if (!timeAttr) return;

    const date = new Date(timeAttr);
    const dateStr = fmtDateDivider(date);

    if (dateStr !== lastDateVal) {
      const divider = document.createElement("div");
      divider.classList.add("chat-date-divider");
      divider.textContent = dateStr;
      msgEl.parentNode.insertBefore(divider, msgEl);
      lastDateVal = dateStr;
    }
  });
};

const fmtLastSeen = (ts, offset = 0) => {
  if (!ts) return "";
  const diff = Math.max(0, Math.floor((Date.now() + offset - ts) / 1000));
  if (diff < 60)     return "Last seen just now";
  if (diff < 3600)   return `Last seen ${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `Last seen ${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `Last seen ${Math.floor(diff / 86400)}d ago`;
  return `Last seen ${new Date(ts).toLocaleDateString((window.storeLocale && window.storeLocale.locale) || undefined, { day: "2-digit", month: "2-digit", year: "numeric" })}`;
};

const paintPresenceRow = (rowEl, isOnline, lastSeenMs, offset = 0) => {
  const dot = rowEl.querySelector("[user-status]");
  if (dot) dot.classList.toggle("d-none", !isOnline);
  const uid = rowEl.getAttribute("user-id");
  const el = rowEl.querySelector(`.user-lastseen[data-user-id="${uid}"]`);
  if (!el) return;
  if (isOnline || !lastSeenMs) {
    delete el.dataset.ts;
    el.textContent = "";
  } else {
    el.dataset.ts = String(lastSeenMs);
    el.textContent = fmtLastSeen(lastSeenMs, offset);
  }
};

const paintPresenceRoster = (listUserOnline = [], lastSeenMap = {}, offset = 0) => {
  const online = new Set(listUserOnline.map(String));
  document.querySelectorAll(".chat-body-left [user-id]").forEach(rowEl => {
    const uid = String(rowEl.getAttribute("user-id"));
    paintPresenceRow(rowEl, online.has(uid), lastSeenMap[uid], offset);
  });
};

const tickPresenceLabels = (offset = 0) => {
  document.querySelectorAll(".user-lastseen[data-ts]").forEach(el => {
    el.textContent = fmtLastSeen(Number(el.dataset.ts), offset);
  });
};

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const linkify = (escaped) => escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (raw) => {
  const trail = raw.match(/[.,!?)\]]+$/);
  const url = trail ? raw.slice(0, -trail[0].length) : raw;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trail ? trail[0] : ""}`;
});

const renderAiText = (raw) => escapeHtml(raw)
  .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
  .replace(/`([^`\n]+)`/g, "<code>$1</code>")
  .replace(/^\s*[-*]\s+(.+)$/gm, "&bull; $1")
  .replace(/\n/g, "<br>");

const showAdminConfirm = (msg, onOk) => {
  const overlay = document.getElementById("admin-confirm-modal");
  const btnOk = document.getElementById("admin-confirm-ok");
  const btnCancel = document.getElementById("admin-confirm-cancel");
  if (!overlay || !btnOk || !btnCancel) {
    if (typeof showConfirm === "function") showConfirm({ title: "Confirm", message: msg, okText: "Confirm", onOk });
    else notyf.error("Confirmation is unavailable. Please reload the page.");
    return;
  }
  const previousFocus = document.activeElement;
  const msgEl = overlay.querySelector(".admin-confirm-msg");
  if (msgEl) msgEl.textContent = msg;
  const close = () => {
    overlay.classList.add("d-none");
    btnOk.onclick = null;
    btnCancel.onclick = null;
    overlay.onclick = null;
    overlay.onkeydown = null;
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  // Replace both callbacks on every opening, including after Cancel.
  btnOk.onclick = () => { close(); onOk(); };
  btnCancel.onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  overlay.onkeydown = event => { if (event.key === "Escape") { event.preventDefault(); close(); } };
  overlay.classList.remove("d-none");
  btnCancel.focus();
};

const formChat = document.querySelector("[form-chat]");
if (formChat) {
  const inputContent  = formChat.querySelector("[input-content]");
  const buttonSend    = formChat.querySelector("[button-send]");
  const chatRoomId    = document.querySelector("[chat-room-id]").getAttribute("chat-room-id");
  const chatDetail    = document.querySelector(".chat-detail");
  const chatBody      = document.querySelector(".chat-body");
  const chatFile      = document.querySelector("#chat-file");
  const chatAttach    = document.querySelector("#chat-attach");
  const chatPreview   = document.querySelector("#chat-preview");
  const statusDot     = document.getElementById("admin-chat-online-dot");
  const statusText    = document.getElementById("admin-chat-status-text");

  let selectedFiles = [];
  let lastAdminMsgId = null;
  let userUnreadCount = 0;
  let isUserOnline = false;

  let serverClockOffset = 0;
  let headerLastSeenAt  = null;
  const applyServerNow = (serverNow) => {
    if (typeof serverNow === "number") serverClockOffset = serverNow - Date.now();
  };

  const tickLastSeenLabels = () => {
    if (headerLastSeenAt && !isUserOnline && statusText) {
      statusText.textContent = fmtLastSeen(headerLastSeenAt, serverClockOffset) || "Offline";
    }
    tickPresenceLabels(serverClockOffset);
  };
  setInterval(tickLastSeenLabels, 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tickLastSeenLabels();
  });

  const updateMessageStatuses = () => {
    const adminMsgStatuses = chatDetail.querySelectorAll(".flex-row-reverse .msg-status[data-status-for]");
    const total = adminMsgStatuses.length;

    adminMsgStatuses.forEach((statusEl, index) => {
      const isUnread = index >= (total - userUnreadCount);
      if (isUnread) {
        if (isUserOnline) {
          statusEl.textContent = "✓✓";
          statusEl.classList.add("delivered");
          statusEl.classList.remove("seen");
        } else {
          statusEl.textContent = "✓";
          statusEl.classList.remove("delivered", "seen");
        }
      } else {
        statusEl.textContent = "✓✓✓";
        statusEl.classList.remove("delivered");
        statusEl.classList.add("seen");
      }
    });
  };

  const socket = io({ auth: { roomId: chatRoomId } });

  const AUTH_ERRORS = [
    "Account not available", "Authentication failed",
    "No token", "No cookies", "Invalid token payload", "Session expired",
  ];
  let authErrorNotified = false;
  socket.on("connect_error", (err) => {
    if (!AUTH_ERRORS.includes(err.message)) return;
    socket.disconnect();
    if (!authErrorNotified) {
      authErrorNotified = true;
      notyf.error("Session expired. Please sign in again.");
    }
  });

  const connBanner = document.getElementById("admin-chat-connection-banner");
  const showConnBanner = (msg) => {
    if (!connBanner) return;
    connBanner.textContent = msg;
    connBanner.classList.remove("d-none");
  };
  const hideConnBanner = () => connBanner?.classList.add("d-none");
  socket.io.on("reconnect_attempt", () => showConnBanner("Reconnecting…"));
  socket.io.on("reconnect", () => hideConnBanner());
  socket.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") showConnBanner("Connection lost. Reconnecting…");
  });

  socket.on("connect", () => { authErrorNotified = false; hideConnBanner(); });

  const emitAdminOpenState = (isOpen) => {
    socket.emit("ADMIN_OPEN_CHAT", { roomId: chatRoomId, isOpen: Boolean(isOpen) });
  };

  const isAdminChatVisible = () => document.visibilityState === "visible";

  socket.on("connect", () => {
    emitAdminOpenState(isAdminChatVisible());
  });

  document.addEventListener("visibilitychange", () => {
    emitAdminOpenState(isAdminChatVisible());
  });

  window.addEventListener("focus", () => {
    emitAdminOpenState(isAdminChatVisible());
  });

  window.addEventListener("blur", () => {
    emitAdminOpenState(false);
  });

  const setUserOnline = () => {
    headerLastSeenAt = null;
    if (statusDot)  statusDot.classList.add("is-online");
    if (statusText) statusText.textContent = "Online";
  };

  const setUserOffline = (lastSeenAt) => {
    if (lastSeenAt) headerLastSeenAt = lastSeenAt;
    if (statusDot)  statusDot.classList.remove("is-online");
    if (statusText) statusText.textContent = fmtLastSeen(headerLastSeenAt, serverClockOffset) || "Offline";
  };

  const appendMessage = (item, isPrepend = false) => {
    if (document.getElementById(item._id)) return;
    const wrap = document.createElement("div");
    wrap.classList.add("d-flex");
    if (item.senderRole === "admin") wrap.classList.add("flex-row-reverse");
    wrap.setAttribute("id", item._id);
    wrap.setAttribute("data-time", item.createdAt || new Date().toISOString());

    const isAdmin = item.senderRole === "admin";
    const time    = item.createdAt ? fmtTime(item.createdAt) : fmtTime();
    let inner     = "";

    if (isAdmin) {
      inner += `<span class="delete-message" data-id="${item._id}" title="Delete">✕</span>`;
    }

    if (item.content) {
      inner += `<p>${linkify(escapeHtml(item.content)).replace(/\n/g, "<br>")}</p>`;
    }

    if (item.files?.length > 0) {
      inner += `<div class="chat-files">`;
      item.files.forEach(file => {
        const url = escapeHtml(domainCDN + file);
        const ext = String(file).split(".").pop().toLowerCase();
        if (["jpg","jpeg","png","gif","webp"].includes(ext)) {
          inner += `<a href="${url}" target="_blank"><img src="${url}" class="chat-image" alt="image"></a>`;
        } else {
          inner += `<a href="${url}" target="_blank"><i class="iconoir-page" style="font-size:16px"></i> File</a>`;
        }
      });
      inner += `</div>`;
    }

    if (isAdmin) {
      inner += `<div class="msg-meta"><span class="msg-time">${time}</span><span class="msg-status" data-status-for="${item._id}">✓</span></div>`;
    } else {
      inner += `<div class="msg-meta"><span class="msg-time">${time}</span></div>`;
    }

    wrap.innerHTML = `
      <div class="chat-box w-100 ${isAdmin ? "reverse" : ""}">
        <div class="user-chat">${inner}</div>
      </div>
    `;

    if (isPrepend) chatDetail.prepend(wrap);
    else           chatDetail.appendChild(wrap);

    if (!isPrepend && isAdmin) lastAdminMsgId = item._id;

    updateDateDividers();
  };

  buttonSend.addEventListener("click", async () => {
    let fileUrls = [];
    if (selectedFiles.length > 0) {
      const fd = new FormData();
      selectedFiles.forEach(f => fd.append("files", f));
      fd.append("roomId", chatRoomId);
      const res  = await fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}/attachments`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.code === "success") fileUrls = data.fileUrls;
    }
    const content = inputContent.value.trim();
    if (content || fileUrls.length > 0) {
      socket.emit("CLIENT_SEND_MESSAGE", { content, files: fileUrls });
      inputContent.value = "";
      selectedFiles = [];
      chatPreview.innerHTML = "";
      chatPreview.classList.add("d-none");
    }
  });

  inputContent.addEventListener("keydown", (e) => {
    // Enter that commits an IME word (e.g. Vietnamese Telex) is followed by a real Enter; sending on both duplicates the message.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); buttonSend.click(); }
  });

  socket.on("SERVER_SEND_MESSAGE", (data) => {
    if (chatRoomId !== data.roomId) return;
    if (data.senderRole === "admin") {
      userUnreadCount += 1;
    }
    appendMessage(data);
    chatBody.scrollTop = chatBody.scrollHeight;
  });

  socket.on("SERVER_MESSAGE_DELIVERED", ({ messageId }) => {
    const statusEl = chatDetail.querySelector(`[data-status-for="${messageId}"]`);
    if (statusEl && !statusEl.classList.contains("seen")) {
      statusEl.textContent = "✓✓";
      statusEl.classList.add("delivered");
    }
  });

  socket.on("SERVER_CLIENT_READ", (data = {}) => {
    userUnreadCount = 0;
    updateMessageStatuses();
  });

  const loadInitialMessages = async () => {
    const res  = await fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}/messages?limit=20`);
    const data = await res.json();
    userUnreadCount = data.userUnreadCount ?? 0;
    for (const item of data.messages) appendMessage(item);
    chatBody.scrollTop = chatBody.scrollHeight;
    updateMessageStatuses();
  };
  loadInitialMessages();

  let isLoading = false, hasMore = true;
  chatBody.addEventListener("scroll", async () => {
    if (chatBody.scrollTop !== 0 || isLoading || !hasMore) return;
    isLoading = true;
    const first   = chatDetail.querySelector(".d-flex");
    const firstId = first?.getAttribute("id");
    if (!firstId) { isLoading = false; return; }
    const res  = await fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}/messages?lastMessageId=${firstId}&limit=20`);
    const data = await res.json();
    if (!data.messages?.length) { hasMore = false; }
    else {
      const old = chatBody.scrollHeight;
      data.messages.forEach(m => appendMessage(m, true));
      chatBody.scrollTop = chatBody.scrollHeight - old;
    }
    isLoading = false;
  });

  socket.on("USER_STATUS_ONLINE", (data) => {
    applyServerNow(data.serverNow);
    const infoUserId = document.querySelector("[chat-room-id]")?.getAttribute("data-user-id");
    if (infoUserId && String(data.id) === String(infoUserId)) {
      if (data.status === "online") {
        setUserOnline();
        isUserOnline = true;
      } else {
        setUserOffline(data.lastSeenAt);
        isUserOnline = false;
      }
      updateMessageStatuses();
    }

    const rowEl = document.querySelector(`.chat-body-left [user-id="${data.id}"]`);
    if (rowEl) paintPresenceRow(rowEl, data.status === "online", data.lastSeenAt, serverClockOffset);
  });

  socket.on("LIST_USER_ONLINE", (data) => {
    applyServerNow(data.serverNow);
    const { listUserOnline = [], lastSeenMap = {} } = data;
    const currentUserId = document.querySelector("[chat-room-id]")?.getAttribute("data-user-id");

    if (currentUserId) {
      const isOnline = listUserOnline.some(id => String(id) === String(currentUserId));
      if (isOnline) {
        setUserOnline();
        isUserOnline = true;
      } else {
        setUserOffline(lastSeenMap[currentUserId]);
        isUserOnline = false;
      }
      updateMessageStatuses();
    }

    paintPresenceRoster(listUserOnline, lastSeenMap, serverClockOffset);
  });

  const getOrCreateAdminTypingBubble = () => {
    let el = document.getElementById("admin-chat-typing");
    if (!el) {
      el = document.createElement("div");
      el.id = "admin-chat-typing";
      el.className = "admin-chat-typing-indicator";
      el.innerHTML = "<span></span><span></span><span></span>";
    }
    return el;
  };

  let userTypingTimeout;
  socket.on("SERVER_SEND_CLIENT_TYPING", ({ isTyping }) => {
    clearTimeout(userTypingTimeout);
    const bubble = getOrCreateAdminTypingBubble();
    if (isTyping) {
      bubble.classList.add("is-typing");
      chatDetail?.appendChild(bubble);
      if (chatDetail) chatDetail.scrollTop = chatDetail.scrollHeight;
      userTypingTimeout = setTimeout(() => {
        bubble.classList.remove("is-typing");
      }, 3000);
    } else {
      bubble.classList.remove("is-typing");
    }
  });

  let typingTimeout, isTyping = false;
  inputContent.addEventListener("keyup", (e) => {
    if (e.key === "Enter") return;
    if (!isTyping) { isTyping = true; socket.emit("ADMIN_TYPING", { isTyping: true }); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      socket.emit("ADMIN_TYPING", { isTyping: false });
    }, 2000);
  });

  chatAttach.addEventListener("click", () => chatFile.click());
  chatFile.addEventListener("change", (e) => {
    Array.from(e.target.files).forEach(file => {
      selectedFiles.push(file);
      const item = document.createElement("div");
      item.classList.add("preview-item");
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = ev => {
          item.innerHTML = `<img src="${ev.target.result}" alt="preview"><div class="preview-remove">×</div>`;
        };
        reader.readAsDataURL(file);
      } else {
        item.innerHTML = `<div class="preview-file-item"><i class="iconoir-page"></i> ${file.name}</div><div class="preview-remove">×</div>`;
      }
      item.addEventListener("click", () => {
        selectedFiles = selectedFiles.filter(f => f !== file);
        item.remove();
        if (!selectedFiles.length) chatPreview.classList.add("d-none");
      });
      chatPreview.appendChild(item);
      chatPreview.classList.remove("d-none");
    });
    chatFile.value = "";
  });

  chatBody.addEventListener("click", (e) => {
    if (!e.target.classList.contains("delete-message")) return;
    const messageId = e.target.getAttribute("data-id");
    showAdminConfirm("This message will be permanently deleted.", () => {
      socket.emit("CLIENT_DELETE_MESSAGE", { messageId });
    });
  });

  socket.on("SERVER_DELETE_MESSAGE", ({ messageId }) => {
    document.querySelector(`.chat-detail [id="${messageId}"]`)?.remove();
  });

  const buttonLock = document.querySelector("[button-lock]");
  buttonLock?.addEventListener("click", () => {
    const status = buttonLock.getAttribute("button-lock");
    fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    })
      .then(r => r.json())
      .then(data => {
        if (data.code === "error")   notyf.error(data.message);
        if (data.code === "success") { drawNotify("success", data.message); window.location.reload(); }
      });
  });

  const buttonDeleteRoom = document.querySelector("[button-delete-room]");
  buttonDeleteRoom?.addEventListener("click", () => {
    showAdminConfirm("This chat room and all messages will be permanently deleted.", () => {
      socket.emit("ADMIN_DELETE_ROOM", { roomId: chatRoomId });
    });
  });

  socket.on("SERVER_DELETE_ROOM", ({ roomId }) => {
    if (roomId !== chatRoomId) return;
    drawNotify("success", "Chat room deleted successfully!");
    window.location.href = `/${pathAdmin}/chat/list/my-chat`;
  });

  socket.on("SERVER_ROOM_STATUS", (data) => {
    if (data?.roomId !== chatRoomId) return;
    const locked = data.status === "locked";
    if (inputContent) inputContent.disabled = locked;
    if (buttonSend)   buttonSend.disabled = locked;
    if (buttonLock) buttonLock.setAttribute("button-lock", locked ? "open" : "locked");
    notyf[locked ? "error" : "success"](
      locked ? "This conversation was locked." : "This conversation was reopened.");
  });

  const chatAiSuggestReply = document.querySelector("#chat-ai-suggest-reply");
  if (chatAiSuggestReply) {
    const boxContent = chatAiSuggestReply.querySelector(".inner-content");

    document.querySelector("#button-ai-suggest-reply")?.addEventListener("click", async () => {
      const res  = await fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}/reply-suggestion`);
      const data = await res.json();
      if (data.code === "success") { boxContent.innerHTML = renderAiText(data.content); chatAiSuggestReply.classList.remove("d-none"); }
    });

    chatAiSuggestReply.querySelector(".inner-close")?.addEventListener("click", () => {
      chatAiSuggestReply.classList.add("d-none");
      boxContent.textContent = "";
    });

    document.querySelector("#button-ai-edit-reply")?.addEventListener("click", async () => {
      const res  = await fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}/reply-refinements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: inputContent.value.trim() })
      });
      const data = await res.json();
      if (data.code === "success") { boxContent.innerHTML = renderAiText(data.content); chatAiSuggestReply.classList.remove("d-none"); }
    });

    document.querySelector("#button-ai-chat-summary")?.addEventListener("click", async () => {
      const res  = await fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}/summary`);
      const data = await res.json();
      if (data.code === "success") { boxContent.innerHTML = renderAiText(data.content); chatAiSuggestReply.classList.remove("d-none"); }
    });

    document.querySelector("#button-ai-customer-emotions")?.addEventListener("click", async () => {
      const res  = await fetch(`/${pathAdmin}/api/chat-rooms/${chatRoomId}/customer-emotion`);
      const data = await res.json();
      if (data.code === "success") { boxContent.innerHTML = renderAiText(data.content); chatAiSuggestReply.classList.remove("d-none"); }
    });
  }
}

if (!formChat && document.querySelector(".chat-body-left")) {
  const socket = io();

  const PRESENCE_AUTH_ERRORS = [
    "Account not available", "Authentication failed",
    "No token", "No cookies", "Invalid token payload", "Session expired",
  ];
  socket.on("connect_error", (err) => {
    if (PRESENCE_AUTH_ERRORS.includes(err.message)) socket.disconnect();
  });

  let offset = 0;
  const syncClock = (serverNow) => {
    if (typeof serverNow === "number") offset = serverNow - Date.now();
  };

  socket.on("LIST_USER_ONLINE", (data = {}) => {
    syncClock(data.serverNow);
    paintPresenceRoster(data.listUserOnline, data.lastSeenMap, offset);
  });

  socket.on("USER_STATUS_ONLINE", (data = {}) => {
    syncClock(data.serverNow);
    const rowEl = document.querySelector(`.chat-body-left [user-id="${data.id}"]`);
    if (rowEl) paintPresenceRow(rowEl, data.status === "online", data.lastSeenAt, offset);
  });

  let assignReloadTimer;
  socket.on("SERVER_ROOM_ASSIGNED", () => {
    clearTimeout(assignReloadTimer);
    assignReloadTimer = setTimeout(() => window.location.reload(), 2000);
  });

  setInterval(() => tickPresenceLabels(offset), 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tickPresenceLabels(offset);
  });
}
