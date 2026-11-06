/**
 * RepliQ WhatsApp Admin Inbox
 * Single Page Application (Plain Vanilla JS, no framework, no browser SDKs)
 * Talks exclusively to /api/admin/* endpoints with automatic 5s polling for live updates.
 */

// Centralized UI texts for easy localization (French / Arabic / English)
const I18N = {
  fr: {
    connecting: "Connexion...",
    activePolling: "🟢 Actif (actualisation 5s)",
    offline: "🔴 Déconnecté",
    loadingConversations: "Chargement des discussions...",
    noConversations: "Aucune conversation enregistrée.",
    customer: "Client",
    bot: "🤖 Bot",
    humanAdmin: "👤 Vous (Admin)",
    takeoverActive: "👤 Prise en main active (Bot muet)",
    takeoverInactive: "Prendre la main",
    windowActive: "⏳ 24h : actif",
    windowRemaining: "restantes",
    windowExpired: "⚠️ Fenêtre 24h expirée",
    sendPlaceholderNormal: "Écrire un message en tant qu'humain...",
    sendPlaceholderDisabled: "Fenêtre 24h expirée : modèle requis",
    loginFailed: "Mot de passe incorrect ou erreur réseau.",
  },
};

const currentLang = "fr";
const t = (key) => I18N[currentLang][key] || key;

// Application State
const state = {
  token: localStorage.getItem("repliq_admin_token") || null,
  conversations: [],
  selectedConversationId: null,
  messages: [],
  pollTimer: null,
};

// DOM Elements
const dom = {
  loginScreen: document.getElementById("loginScreen"),
  appScreen: document.getElementById("appScreen"),
  loginForm: document.getElementById("loginForm"),
  adminPassword: document.getElementById("adminPassword"),
  loginError: document.getElementById("loginError"),
  loginBtn: document.getElementById("loginBtn"),
  inboxLayout: document.getElementById("inboxLayout"),
  logoutBtn: document.getElementById("logoutBtn"),
  realtimeIndicator: document.getElementById("realtimeIndicator"),
  searchInput: document.getElementById("searchInput"),
  conversationList: document.getElementById("conversationList"),
  chatPlaceholder: document.getElementById("chatPlaceholder"),
  chatActive: document.getElementById("chatActive"),
  backToListBtn: document.getElementById("backToListBtn"),
  currentContactName: document.getElementById("currentContactName"),
  currentContactPhone: document.getElementById("currentContactPhone"),
  windowBadge: document.getElementById("windowBadge"),
  takeoverBtn: document.getElementById("takeoverBtn"),
  windowExpiredBanner: document.getElementById("windowExpiredBanner"),
  messagesContainer: document.getElementById("messagesContainer"),
  chatForm: document.getElementById("chatForm"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
};

// ============================================================================
// 1. HTTP API Client Helpers
// ============================================================================

async function apiRequest(endpoint, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new Error("Unauthorized");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(data?.message || data?.error || `HTTP error ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}

function handleUnauthorized() {
  state.token = null;
  localStorage.removeItem("repliq_admin_token");
  dom.appScreen.style.display = "none";
  dom.loginScreen.style.display = "flex";
  stopPolling();
}

// ============================================================================
// 2. Authentication Flow
// ============================================================================

async function checkAuthSession() {
  try {
    const data = await apiRequest("/api/admin/login", { method: "GET" });
    if (data?.authenticated) {
      showAppScreen();
      return true;
    }
  } catch {
    // Not authenticated
  }
  showLoginScreen();
  return false;
}

function showLoginScreen() {
  dom.loginScreen.style.display = "flex";
  dom.appScreen.style.display = "none";
  dom.adminPassword.focus();
}

function showAppScreen() {
  dom.loginScreen.style.display = "none";
  dom.appScreen.style.display = "flex";
  startPolling();
  loadConversations();
}

dom.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  dom.loginError.style.display = "none";
  dom.loginBtn.disabled = true;
  dom.loginBtn.textContent = "Connexion en cours...";

  try {
    const password = dom.adminPassword.value.trim();
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || t("loginFailed"));
    }

    state.token = data.token;
    localStorage.setItem("repliq_admin_token", data.token);

    dom.adminPassword.value = "";
    showAppScreen();
  } catch (err) {
    dom.loginError.textContent = err.message || t("loginFailed");
    dom.loginError.style.display = "block";
  } finally {
    dom.loginBtn.disabled = false;
    dom.loginBtn.textContent = "Connexion";
  }
});

dom.logoutBtn.addEventListener("click", () => {
  handleUnauthorized();
});

// ============================================================================
// 3. Conversation List & Rendering
// ============================================================================

async function loadConversations(silent = false) {
  try {
    const data = await apiRequest("/api/admin/conversations");
    state.conversations = data.conversations || [];
    renderConversationList();

    // If an active conversation is open, refresh its header info
    if (state.selectedConversationId) {
      const active = state.conversations.find((c) => c.id === state.selectedConversationId);
      if (active) {
        updateChatHeader(active);
      }
    }
  } catch (err) {
    if (!silent) {
      console.error("Failed to load conversations:", err);
      dom.conversationList.innerHTML = `<div class="empty-list-placeholder">Erreur de chargement des conversations.</div>`;
    }
  }
}

function renderConversationList() {
  const query = (dom.searchInput.value || "").toLowerCase().trim();
  const filtered = state.conversations.filter((c) => {
    if (!query) return true;
    const name = (c.contact_name || "").toLowerCase();
    const phone = (c.wa_contact_phone || "").toLowerCase();
    const lastMsg = (c.last_message?.body || "").toLowerCase();
    return name.includes(query) || phone.includes(query) || lastMsg.includes(query);
  });

  if (filtered.length === 0) {
    dom.conversationList.innerHTML = `<div class="empty-list-placeholder">${t("noConversations")}</div>`;
    return;
  }

  dom.conversationList.innerHTML = "";
  filtered.forEach((convo) => {
    const item = document.createElement("div");
    item.className = `convo-item ${convo.id === state.selectedConversationId ? "active" : ""}`;
    item.dataset.id = convo.id;

    const title = convo.contact_name || convo.wa_contact_phone || "Inconnu";
    const lastMsg = convo.last_message ? convo.last_message.body : "Nouvelle conversation";
    const timeStr = formatTimestamp(convo.last_message_at || convo.created_at);
    const isHuman = Boolean(convo.human_takeover);

    item.innerHTML = `
      <div class="convo-avatar">${convo.contact_name ? convo.contact_name.charAt(0).toUpperCase() : "📱"}</div>
      <div class="convo-content">
        <div class="convo-top">
          <span class="convo-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
          <span class="convo-time">${timeStr}</span>
        </div>
        <div class="convo-bottom">
          <span class="convo-snippet" title="${escapeHtml(lastMsg)}">${escapeHtml(lastMsg)}</span>
          <div class="convo-badges">
            <span class="tag-badge ${isHuman ? "tag-human" : "tag-bot"}">${isHuman ? "👤 Humain" : "🤖 Bot"}</span>
            ${convo.unread_count > 0 ? `<span class="unread-badge">${convo.unread_count}</span>` : ""}
          </div>
        </div>
      </div>
    `;

    item.addEventListener("click", () => selectConversation(convo.id));
    dom.conversationList.appendChild(item);
  });
}

dom.searchInput.addEventListener("input", () => {
  renderConversationList();
});

// ============================================================================
// 4. Chat View & Messages
// ============================================================================

async function selectConversation(conversationId) {
  state.selectedConversationId = conversationId;
  renderConversationList();

  const convo = state.conversations.find((c) => c.id === conversationId);
  if (!convo) return;

  // Mobile layout switch
  dom.inboxLayout.classList.add("chat-open");

  // Show active chat pane
  dom.chatPlaceholder.style.display = "none";
  dom.chatActive.style.display = "flex";

  updateChatHeader(convo);

  // Reset unread count on server
  if (convo.unread_count > 0) {
    convo.unread_count = 0;
    renderConversationList();
    apiRequest("/api/admin/read", {
      method: "POST",
      body: JSON.stringify({ conversationId }),
    }).catch((e) => console.error("Error resetting unread count:", e));
  }

  // Load message history
  await loadMessages(conversationId);
}

function updateChatHeader(convo) {
  dom.currentContactName.textContent = convo.contact_name || convo.wa_contact_phone;
  dom.currentContactPhone.textContent = convo.wa_contact_phone;

  // Update Takeover toggle button
  if (convo.human_takeover) {
    dom.takeoverBtn.classList.add("active");
    dom.takeoverBtn.innerHTML = `<span class="takeover-icon">👤</span> <span class="takeover-label">${t("takeoverActive")}</span>`;
  } else {
    dom.takeoverBtn.classList.remove("active");
    dom.takeoverBtn.innerHTML = `<span class="takeover-icon">🤖</span> <span class="takeover-label">${t("takeoverInactive")}</span>`;
  }

  // Calculate 24h Meta Customer Service window
  const now = Date.now();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  let isWindowOpen = false;
  let remainingMs = 0;

  if (convo.last_inbound_at) {
    const lastInboundTs = new Date(convo.last_inbound_at).getTime();
    if (!Number.isNaN(lastInboundTs)) {
      const expiresAt = lastInboundTs + TWENTY_FOUR_HOURS_MS;
      remainingMs = Math.max(0, expiresAt - now);
      isWindowOpen = remainingMs > 0;
    }
  }

  if (isWindowOpen) {
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    dom.windowBadge.className = "window-pill open";
    dom.windowBadge.textContent = `⏳ 24h active (${hours}h ${mins}m)`;
    dom.windowExpiredBanner.style.display = "none";
    dom.messageInput.disabled = false;
    dom.sendBtn.disabled = false;
    dom.messageInput.placeholder = t("sendPlaceholderNormal");
  } else {
    dom.windowBadge.className = "window-pill expired";
    dom.windowBadge.textContent = t("windowExpired");
    dom.windowExpiredBanner.style.display = "flex";
    dom.messageInput.disabled = true;
    dom.sendBtn.disabled = true;
    dom.messageInput.placeholder = t("sendPlaceholderDisabled");
  }
}

async function loadMessages(conversationId) {
  try {
    const data = await apiRequest(`/api/admin/messages?conversationId=${encodeURIComponent(conversationId)}`);
    state.messages = data.messages || [];
    renderMessages();
    scrollToBottom();
  } catch (err) {
    console.error("Failed to load messages:", err);
  }
}

function renderMessages() {
  dom.messagesContainer.innerHTML = "";

  if (state.messages.length === 0) {
    dom.messagesContainer.innerHTML = `<div class="empty-list-placeholder">Aucun message pour l'instant.</div>`;
    return;
  }

  state.messages.forEach((msg) => {
    const wrapper = document.createElement("div");
    const direction = msg.direction || (msg.sender === "customer" ? "inbound" : "outbound");
    const sender = msg.sender || (direction === "inbound" ? "customer" : "bot");

    wrapper.className = `msg-wrapper ${direction} ${sender}`;

    let senderLabel = "";
    if (sender === "customer") senderLabel = t("customer");
    else if (sender === "bot") senderLabel = t("bot");
    else if (sender === "human") senderLabel = t("humanAdmin");

    const timeStr = formatTimestamp(msg.created_at);
    const tickHtml = getStatusTickHtml(msg);

    wrapper.innerHTML = `
      <div class="msg-bubble">
        <div class="msg-sender-tag">${senderLabel}</div>
        <div class="msg-body">${escapeHtml(msg.body || "")}</div>
        <div class="msg-meta">
          <span class="msg-time">${timeStr}</span>
          ${tickHtml}
        </div>
        ${msg.error ? `<div class="msg-error-note">⚠️ ${escapeHtml(msg.error)}</div>` : ""}
      </div>
    `;

    dom.messagesContainer.appendChild(wrapper);
  });
}

function getStatusTickHtml(msg) {
  if (msg.direction !== "outbound") return "";
  const status = msg.status || "sent";

  if (status === "read") {
    return `<span class="msg-status-tick read" title="Lu">✓✓</span>`;
  }
  if (status === "delivered") {
    return `<span class="msg-status-tick" title="Distribué">✓✓</span>`;
  }
  if (status === "failed") {
    return `<span class="msg-status-tick failed" title="Échec">⚠️</span>`;
  }
  return `<span class="msg-status-tick" title="Envoyé">✓</span>`;
}

function scrollToBottom() {
  dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
}

// Mobile back button
dom.backToListBtn.addEventListener("click", () => {
  dom.inboxLayout.classList.remove("chat-open");
});

// ============================================================================
// 5. Send Message (Human Takeover Reply)
// ============================================================================

dom.chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = dom.messageInput.value.trim();
  if (!text || !state.selectedConversationId) return;

  const conversationId = state.selectedConversationId;
  const convo = state.conversations.find((c) => c.id === conversationId);

  // Optimistic message append
  const optimisticId = `temp_${Date.now()}`;
  const optimisticMsg = {
    id: optimisticId,
    conversation_id: conversationId,
    direction: "outbound",
    sender: "human",
    body: text,
    status: "sent",
    created_at: new Date().toISOString(),
  };

  state.messages.push(optimisticMsg);
  renderMessages();
  scrollToBottom();
  dom.messageInput.value = "";

  try {
    const result = await apiRequest("/api/admin/send", {
      method: "POST",
      body: JSON.stringify({ conversationId, text }),
    });

    // Replace optimistic message with server record
    const idx = state.messages.findIndex((m) => m.id === optimisticId);
    if (idx !== -1 && result.message) {
      state.messages[idx] = result.message;
      renderMessages();
    }

    // Refresh conversation in list
    loadConversations(true);
  } catch (err) {
    console.error("Send error:", err);
    const idx = state.messages.findIndex((m) => m.id === optimisticId);
    if (idx !== -1) {
      state.messages[idx].status = "failed";
      state.messages[idx].error = err.message || "Échec d'envoi";
      renderMessages();
    }

    if (err.data?.code === "WINDOW_EXPIRED" || err.status === 409) {
      if (convo) {
        convo.last_inbound_at = null; // Mark expired
        updateChatHeader(convo);
      }
      alert("⚠️ " + (err.message || t("windowExpired")));
    }
  }
});

// Auto-expand textarea on typing & Enter to send
dom.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    dom.chatForm.dispatchEvent(new Event("submit"));
  }
});

// ============================================================================
// 6. Takeover Toggle
// ============================================================================

dom.takeoverBtn.addEventListener("click", async () => {
  if (!state.selectedConversationId) return;

  const convo = state.conversations.find((c) => c.id === state.selectedConversationId);
  if (!convo) return;

  const newTakeover = !convo.human_takeover;
  convo.human_takeover = newTakeover;
  updateChatHeader(convo);
  renderConversationList();

  try {
    await apiRequest("/api/admin/takeover", {
      method: "POST",
      body: JSON.stringify({
        conversationId: state.selectedConversationId,
        enabled: newTakeover,
      }),
    });
  } catch (err) {
    console.error("Takeover toggle error:", err);
    // Revert state on failure
    convo.human_takeover = !newTakeover;
    updateChatHeader(convo);
    renderConversationList();
    alert("Impossible de modifier la prise en main : " + err.message);
  }
});

// ============================================================================
// 7. Polling Mechanism (Every 5 seconds)
// ============================================================================

function startPolling() {
  stopPolling();
  updateStatusIndicator("online", t("activePolling"));

  state.pollTimer = setInterval(async () => {
    // 1. Refresh conversation list quietly
    await loadConversations(true);

    // 2. If a conversation is actively open, refresh its messages quietly
    if (state.selectedConversationId) {
      try {
        const data = await apiRequest(`/api/admin/messages?conversationId=${encodeURIComponent(state.selectedConversationId)}`);
        if (data?.messages) {
          const currentCount = state.messages.length;
          const newCount = data.messages.length;
          const statusChanged = JSON.stringify(data.messages.map((m) => m.status)) !== JSON.stringify(state.messages.map((m) => m.status));

          if (newCount !== currentCount || statusChanged) {
            const wasAtBottom = dom.messagesContainer.scrollHeight - dom.messagesContainer.scrollTop <= dom.messagesContainer.clientHeight + 60;
            state.messages = data.messages;
            renderMessages();
            if (wasAtBottom || newCount > currentCount) {
              scrollToBottom();
            }
          }
        }
      } catch {
        // Quiet failure during background polling
      }
    }
  }, 5000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  updateStatusIndicator("offline", t("offline"));
}

function updateStatusIndicator(mode, text) {
  dom.realtimeIndicator.className = `status-indicator ${mode}`;
  const textSpan = dom.realtimeIndicator.querySelector(".status-text");
  if (textSpan) textSpan.textContent = text;
}

// ============================================================================
// 8. Utility Functions
// ============================================================================

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTimestamp(isoOrMs) {
  if (!isoOrMs) return "";
  const date = new Date(isoOrMs);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  const timeOnly = `${hours}:${mins}`;

  if (isToday) return timeOnly;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Hier ${timeOnly}`;

  return `${date.getDate()}/${date.getMonth() + 1} ${timeOnly}`;
}

// ============================================================================
// 9. Startup
// ============================================================================
window.addEventListener("DOMContentLoaded", () => {
  checkAuthSession();
});
