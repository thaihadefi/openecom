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
  const chatBody = document.getElementById("chat-body");
  if (!chatBody) return;
  chatBody.querySelectorAll(".chat-date-divider").forEach(el => el.remove());

  const messages = chatBody.querySelectorAll(".message");
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
  if (!ts) return "Offline";
  const diff = Math.max(0, Math.floor((Date.now() + offset - ts) / 1000));
  if (diff < 60)     return "Last seen just now";
  if (diff < 3600)   return `Last seen ${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `Last seen ${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `Last seen ${Math.floor(diff / 86400)}d ago`;
  return `Last seen ${new Date(ts).toLocaleDateString((window.storeLocale && window.storeLocale.locale) || undefined, { day: "2-digit", month: "2-digit", year: "numeric" })}`;
};

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

const linkify = (escaped) => escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (raw) => {
  const trail = raw.match(/[.,!?)\]]+$/);
  const url = trail ? raw.slice(0, -trail[0].length) : raw;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trail ? trail[0] : ""}`;
});

const showConfirm = (msg, onOk) => {
  const overlay = document.getElementById("chat-confirm-modal");
  const btnOk = document.getElementById("chat-confirm-ok");
  const btnCancel = document.getElementById("chat-confirm-cancel");
  if (!overlay || !btnOk || !btnCancel) {
    if (typeof confirmAction === "function") confirmAction(msg, onOk);
    else notyf.error("Confirmation is unavailable. Please reload the page.");
    return;
  }
  const previousFocus = document.activeElement;
  const msgEl = overlay.querySelector(".chat-confirm-msg");
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

const chatButton = document.querySelector("#chat-button");

if (chatButton) {
  const socket = io({ auth: { role: "user" } });

  const AUTH_ERRORS = [
    "Account not available", "Authentication failed",
    "No token", "No cookies", "Invalid token payload", "Session expired",
  ];
  let sessionRecoveryTried = false;
  let sessionEndedNotified = false;

  socket.on("connect_error", async (err) => {
    console.error("[Chat] Socket error:", err.message);
    if (!AUTH_ERRORS.includes(err.message)) return;

    socket.disconnect();

    if (!sessionRecoveryTried) {
      sessionRecoveryTried = true;
      try {
        const res = await fetch("/api/sessions/current", { credentials: "same-origin" });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { socket.connect(); return; }
      } catch { /* fall through to the notice */ }
    }

    if (!sessionEndedNotified) {
      sessionEndedNotified = true;
      notyf.error("Your session has ended. Please log in again to use chat.");
    }
  });
  const connBanner = document.getElementById("chat-connection-banner");
  const showConnBanner = (msg) => {
    if (!connBanner) return;
    connBanner.textContent = msg;
    connBanner.classList.remove("d-none");
  };
  const hideConnBanner = () => connBanner?.classList.add("d-none");

  socket.io.on("reconnect_attempt", () => showConnBanner("Reconnecting…"));
  socket.io.on("reconnect", () => hideConnBanner());

  socket.on("connect", () => {
    sessionRecoveryTried = false;
    sessionEndedNotified = false;
    hideConnBanner();
  });
  socket.on("disconnect", (reason) => {
    console.warn("[Chat] Disconnected:", reason);
    if (reason !== "io client disconnect") showConnBanner("Connection lost. Reconnecting…");
  });
  const chatPopup    = document.getElementById("chat-popup");
  const chatClose    = document.getElementById("chat-close");
  const chatBody     = document.getElementById("chat-body");
  const chatCount    = document.getElementById("chat-count");
  const chatInput    = document.getElementById("chat-input");
  const chatSend     = document.getElementById("chat-send");
  const chatFile     = document.getElementById("chat-file");
  const chatAttach   = document.getElementById("chat-attach");
  const chatPreview  = document.getElementById("chat-preview");
  const chatTyping   = document.getElementById("chat-typing");
  const statusText   = document.getElementById("chat-header-status");
  const onlineDot    = document.getElementById("chat-online-dot");

  let selectedFiles = [];
  let lastSentId    = null;
  let adminUnreadCount = 0;
  let isAdminOnline = false;

  let serverClockOffset = 0;
  let adminLastSeenAt   = null;
  let lastSeenTimer     = null;

  const updateMessageStatuses = () => {
    const userMsgStatuses = chatBody.querySelectorAll(".message.user .msg-status[data-status-for]");
    const total = userMsgStatuses.length;

    userMsgStatuses.forEach((statusEl, index) => {
      const isUnread = index >= (total - adminUnreadCount);
      if (isUnread) {
        if (isAdminOnline) {
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

  const renderLastSeen = () => {
    if (statusText) statusText.textContent = fmtLastSeen(adminLastSeenAt, serverClockOffset);
  };
  const stopLastSeenTicker = () => {
    if (lastSeenTimer) { clearInterval(lastSeenTimer); lastSeenTimer = null; }
  };

  const setOnline = () => {
    stopLastSeenTicker();
    adminLastSeenAt = null;
    if (statusText) statusText.textContent = "Online";
    if (onlineDot)  onlineDot.classList.add("is-online");
  };
  const setOffline = (lastSeenAt) => {
    if (lastSeenAt) adminLastSeenAt = lastSeenAt;
    renderLastSeen();
    if (onlineDot) onlineDot.classList.remove("is-online");
    stopLastSeenTicker();
    lastSeenTimer = setInterval(renderLastSeen, 30000);
  };

  const emitChatOpenState = (isOpen) => {
    socket.emit("CLIENT_OPEN_CHAT", { isOpen: Boolean(isOpen) });
  };

  const isChatVisible = () => chatPopup && !chatPopup.classList.contains("hidden") && document.visibilityState === "visible";

  const updateChatBadge = (count) => {
    if (!chatCount) return;
    const num = parseInt(count || "0");
    chatCount.textContent = String(num);
    if (num > 0) {
      chatCount.classList.remove("d-none");
    } else {
      chatCount.classList.add("d-none");
    }
  };

  chatButton.addEventListener("click", () => {
    chatPopup.classList.toggle("hidden");
    if (!chatPopup.classList.contains("hidden")) {
      chatBody.scrollTop = chatBody.scrollHeight;
      updateChatBadge(0);
    }
    emitChatOpenState(isChatVisible());
  });
  chatClose?.addEventListener("click", () => {
    chatPopup.classList.add("hidden");
    emitChatOpenState(false);
  });

  window.openSupportChat = (prefillMsg) => {
    if (chatPopup && chatPopup.classList.contains("hidden")) {
      chatPopup.classList.remove("hidden");
      chatBody.scrollTop = chatBody.scrollHeight;
      updateChatBadge(0);
      emitChatOpenState(isChatVisible());
    }
    if (chatInput && prefillMsg) {
      chatInput.value = prefillMsg;
      chatInput.focus();
    }
  };

  const defaultInputPlaceholder = chatInput?.getAttribute("placeholder") || "Type a message...";
  const setChatLocked = (locked) => {
    if (chatInput) {
      chatInput.disabled = locked;
      chatInput.placeholder = locked ? "This conversation is locked" : defaultInputPlaceholder;
    }
    if (chatSend)   chatSend.disabled = locked;
    if (chatAttach) chatAttach.disabled = locked;
  };

  const sendMessage = async () => {
    if (chatInput?.disabled) return;
    let fileUrls = [];
    if (selectedFiles.length > 0) {
      const fd = new FormData();
      selectedFiles.forEach(f => fd.append("files", f));
      const res  = await fetch("/api/chat-rooms/current/attachments", { method: "POST", body: fd });
      const data = await res.json();
      if (data.code === "success") fileUrls = data.fileUrls;
    }
    const content = chatInput.value.trim();
    if (content || fileUrls.length > 0) {
      socket.emit("CLIENT_SEND_MESSAGE", { content, files: fileUrls });
      chatInput.value = "";
      selectedFiles   = [];
      chatPreview.innerHTML = "";
      chatPreview.classList.add("d-none");
    }
  };

  let clientTypingTimeout, isClientTyping = false;
  chatInput?.addEventListener("keyup", (e) => {
    if (e.key === "Enter") return;
    if (!isClientTyping) {
      isClientTyping = true;
      socket.emit("CLIENT_TYPING", { isTyping: true });
    }
    clearTimeout(clientTypingTimeout);
    clientTypingTimeout = setTimeout(() => {
      isClientTyping = false;
      socket.emit("CLIENT_TYPING", { isTyping: false });
    }, 2000);
  });

  chatSend?.addEventListener("click", sendMessage);
  chatInput?.addEventListener("keydown", (e) => {
    // Enter that commits an IME word (e.g. Vietnamese Telex) is followed by a real Enter; sending on both duplicates the message.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isClientTyping) {
        isClientTyping = false;
        clearTimeout(clientTypingTimeout);
        socket.emit("CLIENT_TYPING", { isTyping: false });
      }
      sendMessage();
    }
  });

  const appendMessage = (item, isPrepend = false) => {
    if (document.getElementById(item._id)) return;
    const wrap = document.createElement("div");
    wrap.classList.add("message", item.senderRole);
    wrap.setAttribute("id", item._id);
    wrap.setAttribute("data-time", item.createdAt || new Date().toISOString());

    let html = "";

    if (item.senderRole === "user") {
      html += `<button type="button" class="delete-message" data-id="${item._id}" aria-label="Delete message" title="Delete">×</button>`;
    }

    if (item.content) {
      html += `<div class="bubble">${linkify(escapeHtml(item.content)).replace(/\n/g, "<br>")}</div>`;
    }

    if (item.files?.length > 0) {
      html += `<div class="message-files">`;
      item.files.forEach(file => {
        const url = escapeHtml(domainCDN + file);
        const ext = String(file).split(".").pop().toLowerCase();
        if (["jpg","jpeg","png","gif","webp"].includes(ext)) {
          html += `<a href="${url}" target="_blank"><img src="${url}" class="chat-image" alt="image"></a>`;
        } else {
          html += `<a href="${url}" target="_blank"><i class="fas fa-file"></i> Attached file</a>`;
        }
      });
      html += `</div>`;
    }

    const time = item.createdAt ? fmtTime(item.createdAt) : fmtTime();
    if (item.senderRole === "user") {
      html += `<div class="msg-meta"><span class="msg-time">${time}</span><span class="msg-status" data-status-for="${item._id}">✓</span></div>`;
    } else {
      html += `<div class="msg-meta"><span class="msg-time">${time}</span></div>`;
    }

    wrap.innerHTML = html;
    if (isPrepend) chatBody.prepend(wrap);
    else           chatBody.appendChild(wrap);

    if (!isPrepend && item.senderRole === "user") lastSentId = item._id;

    updateDateDividers();
  };

  socket.on("SERVER_SEND_MESSAGE", (data) => {
    if (data.senderRole === "user") {
      adminUnreadCount += 1;
    }
    appendMessage(data);
    chatBody.scrollTop = chatBody.scrollHeight;
    if (chatPopup.classList.contains("hidden")) {
      const cur = parseInt(chatCount?.textContent || "0");
      updateChatBadge(cur + 1);
    } else {
      emitChatOpenState(isChatVisible());
      updateChatBadge(0);
    }
  });

  socket.on("SERVER_MESSAGE_DELIVERED", ({ messageId }) => {
    const statusEl = chatBody.querySelector(`[data-status-for="${messageId}"]`);
    if (statusEl && !statusEl.classList.contains("seen")) {
      statusEl.textContent = "✓✓";
      statusEl.classList.add("delivered");
    }
  });

  socket.on("SERVER_ADMIN_READ", (data = {}) => {
    adminUnreadCount = 0;
    updateMessageStatuses();
  });

  const loadInitialMessages = async () => {
    try {
      const res  = await fetch("/api/chat-rooms/current/messages?limit=20");
      const data = await res.json();
      if (data.code === "success" && Array.isArray(data.messages)) {
        adminUnreadCount = data.adminUnreadCount ?? 0;
        setChatLocked(data.roomStatus === "locked");
        data.messages.forEach(m => appendMessage(m));
        chatBody.scrollTop = chatBody.scrollHeight;
        updateMessageStatuses();
      }
    } catch (e) { console.warn("Could not load chat messages:", e); }
  };

  document.addEventListener("visibilitychange", () => {
    emitChatOpenState(isChatVisible());
    if (document.visibilityState === "visible" && !isAdminOnline && adminLastSeenAt) renderLastSeen();
  });

  window.addEventListener("focus", () => {
    emitChatOpenState(isChatVisible());
    if (!isAdminOnline && adminLastSeenAt) renderLastSeen();
  });

  window.addEventListener("blur", () => {
    emitChatOpenState(false);
  });
  let loadTimeout = null;
  const onConnect = () => {
    chatBody.innerHTML = "";
    hasMore   = true;
    isLoading = false;
    clearTimeout(loadTimeout);
    loadTimeout = setTimeout(loadInitialMessages, 300);
  };

  if (socket.connected) onConnect();
  socket.on("connect", onConnect);

  let isLoading = false;
  let hasMore   = true;
  chatBody.addEventListener("scroll", async () => {
    if (chatBody.scrollTop !== 0 || isLoading || !hasMore) return;
    isLoading = true;
    const first   = chatBody.querySelector(".message");
    const firstId = first?.getAttribute("id");
    if (!firstId) { isLoading = false; return; }
    try {
      const res  = await fetch(`/api/chat-rooms/current/messages?lastMessageId=${firstId}&limit=20`);
      const data = await res.json();
      if (!data.messages?.length) { hasMore = false; }
      else {
        const old = chatBody.scrollHeight;
        data.messages.forEach(m => appendMessage(m, true));
        chatBody.scrollTop = chatBody.scrollHeight - old;
      }
    } catch (e) { console.warn("Could not load older messages:", e); }
    isLoading = false;
  });

  const getOrCreateTypingBubble = () => {
    let el = document.getElementById("chat-typing");
    if (!el) {
      el = document.createElement("div");
      el.id = "chat-typing";
      el.className = "chat-typing-indicator";
      el.innerHTML = "<span></span><span></span><span></span>";
    }
    return el;
  };

  let adminTypingTimeout;
  socket.on("SERVER_SEND_ADMIN_TYPING", ({ isTyping }) => {
    clearTimeout(adminTypingTimeout);
    const bubble = getOrCreateTypingBubble();
    if (isTyping) {
      bubble.classList.add("is-typing");
      chatBody?.appendChild(bubble);
      if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
      adminTypingTimeout = setTimeout(() => {
        bubble.classList.remove("is-typing");
      }, 3000);
    } else {
      bubble.classList.remove("is-typing");
    }
  });

  socket.on("USER_STATUS_ONLINE", () => {
  });

  socket.on("SERVER_ADMIN_STATUS", (data) => {
    if (typeof data.serverNow === "number") serverClockOffset = data.serverNow - Date.now();
    if (data.status === "online") {
      setOnline();
      isAdminOnline = true;
    } else {
      setOffline(data.lastSeenAt);
      isAdminOnline = false;
    }
    updateMessageStatuses();
  });

  socket.on("SERVER_ROOM_STATUS", (data) => {
    const locked = data?.status === "locked";
    setChatLocked(locked);
    notyf[locked ? "error" : "success"](
      locked ? "This conversation has been locked by support."
             : "This conversation has been reopened."
    );
  });

  chatAttach?.addEventListener("click", () => chatFile?.click());
  chatFile?.addEventListener("change", (e) => {
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
        item.innerHTML = `<div class="preview-file"><i class="fas fa-file"></i> ${file.name}</div><div class="preview-remove">×</div>`;
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
    showConfirm("This message will be permanently deleted.", () => {
      socket.emit("CLIENT_DELETE_MESSAGE", { messageId });
    });
  });

  socket.on("SERVER_DELETE_MESSAGE", ({ messageId }) => {
    document.getElementById(messageId)?.remove();
  });

  socket.on("SERVER_SEND_STATUS", ({ code, message }) => {
    if (code === "success") notyf.success(message);
    else if (code === "error")  notyf.error(message);
  });
}

const buttonRate = document.getElementById("button-rate");
if (buttonRate) {
  const chatRate      = document.getElementById("chat-rate");
  const btnRateClose  = document.getElementById("button-rate-close");
  const stars         = document.querySelectorAll("#rate-stars .star");
  const rateContent   = document.getElementById("rate-content");
  const rateSubmit    = document.getElementById("rate-submit");

  buttonRate.addEventListener("click",    () => chatRate?.classList.remove("d-none"));
  btnRateClose?.addEventListener("click", () => chatRate?.classList.add("d-none"));

  stars.forEach((star, i) => {
    star.addEventListener("click", () => {
      stars.forEach(s => s.classList.remove("active"));
      for (let j = 0; j <= i; j++) stars[j].classList.add("active");
    });
  });

  rateSubmit?.addEventListener("click", () => {
    const totalStar = document.querySelectorAll("#rate-stars .star.active").length;
    if (!totalStar) { notyf.error("Please select at least 1 star!"); return; }
    fetch("/api/chat-rooms/current/rating", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars: totalStar, comment: rateContent?.value.trim() })
    })
      .then(r => r.json())
      .then(data => {
        if (data.code === "success") {
          notyf.success(data.message);
          chatRate?.classList.add("d-none");
          stars.forEach(s => s.classList.remove("active"));
          if (rateContent) rateContent.value = "";
        } else {
          notyf.error(data.message);
        }
      });
  });
}
