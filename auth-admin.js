(function () {
  let currentUser = null;

  async function readJsonSafe(response) {
    const text = await response.text();
    try { return JSON.parse(text || "{}"); }
    catch (_) { return { error: text || "Invalid server response" }; }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await readJsonSafe(response);
    if (!response.ok || data.error) throw new Error(data.error || "Request failed");
    return data;
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function appendUi() {
    if (document.getElementById("auth-ui-wrap")) return;

    const navRight = document.getElementById("export-btn")?.parentElement;
    if (navRight) {
      navRight.insertAdjacentHTML("beforeend", `
        <div id="auth-ui-wrap" class="flex items-center gap-2 ml-2">
          <button id="dashboard-tab" class="tab hidden" onclick="showUserDashboard()">Dashboard</button>
          <button id="admin-tab" class="tab hidden" onclick="showAdminDashboard()">Admin</button>
          <div id="auth-guest" class="flex items-center gap-2">
            <button class="btn btn-ghost" onclick="showPg('login')">Sign in</button>
            <button class="btn btn-primary" style="padding:10px 16px" onclick="showPg('register')">Get started</button>
          </div>
          <div id="auth-user" class="hidden items-center gap-2">
            <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" id="auth-avatar" style="background:linear-gradient(135deg,var(--teal),var(--blue));color:#fff">S</div>
            <span id="auth-name" class="hidden md:inline text-sm font-semibold" style="color:var(--text-muted)"></span>
            <button class="btn btn-ghost" onclick="logoutUser()">Logout</button>
          </div>
        </div>
      `);
    }

    const homeSection = document.getElementById("pg-home");
    if (homeSection) {
      homeSection.insertAdjacentHTML("afterend", `
        <section id="pg-login" class="pg-center z min-h-screen items-center justify-center px-4 py-16">
          <div class="w-full max-w-md glass p-8">
            <div class="text-center mb-8">
              <div class="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style="background:var(--teal-dim);border:1px solid var(--border-teal)">
                <i class="fas fa-right-to-bracket text-3xl" style="color:var(--teal)"></i>
              </div>
              <h2 class="text-3xl font-bold tracking-tight">Sign in to <span class="grad-text">SkillBridge</span></h2>
              <p class="text-sm mt-2" style="color:var(--text-muted)">Registration is required before using analysis, assessments, and interview workflows.</p>
            </div>
            <div class="space-y-4">
              <div><label class="lbl">Email</label><input id="login-email" class="inp" type="email" placeholder="you@example.com" /></div>
              <div><label class="lbl">Password</label><input id="login-password" class="inp" type="password" placeholder="Minimum 8 characters" /></div>
              <div id="login-error" class="hidden p-3 rounded-xl text-sm" style="background:var(--red-dim);color:var(--red);border:1px solid rgba(239,68,68,.2)"></div>
              <button class="btn btn-primary w-full" onclick="doLogin()"><i class="fas fa-right-to-bracket"></i> Sign in</button>
            </div>
            <div class="mt-6 text-center text-sm" style="color:var(--text-muted)">
              New here?
              <button onclick="showPg('register')" style="background:none;border:none;cursor:pointer;color:var(--teal);font-weight:600">Create an account</button>
            </div>
          </div>
        </section>

        <section id="pg-register" class="pg-center z min-h-screen items-center justify-center px-4 py-16">
          <div class="w-full max-w-md glass p-8">
            <div class="text-center mb-8">
              <div class="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style="background:var(--blue-dim);border:1px solid rgba(59,130,246,.25)">
                <i class="fas fa-user-plus text-3xl" style="color:var(--blue)"></i>
              </div>
              <h2 class="text-3xl font-bold tracking-tight">Create your <span class="grad-text">account</span></h2>
              <p class="text-sm mt-2" style="color:var(--text-muted)">Your analyses, assessments, and interview activity will be stored in your private account.</p>
            </div>
            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div><label class="lbl">First name</label><input id="register-first-name" class="inp" placeholder="Angel" /></div>
                <div><label class="lbl">Last name</label><input id="register-last-name" class="inp" placeholder="Egwaoje" /></div>
              </div>
              <div><label class="lbl">Email</label><input id="register-email" class="inp" type="email" placeholder="you@example.com" /></div>
              <div><label class="lbl">Password</label><input id="register-password" class="inp" type="password" placeholder="Minimum 8 characters" /></div>
              <div id="register-error" class="hidden p-3 rounded-xl text-sm" style="background:var(--red-dim);color:var(--red);border:1px solid rgba(239,68,68,.2)"></div>
              <button class="btn btn-primary w-full" onclick="doRegister()"><i class="fas fa-user-plus"></i> Create account</button>
            </div>
            <div class="mt-6 text-center text-sm" style="color:var(--text-muted)">
              Already registered?
              <button onclick="showPg('login')" style="background:none;border:none;cursor:pointer;color:var(--teal);font-weight:600">Sign in</button>
            </div>
          </div>
        </section>

        <section id="pg-dashboard" class="pg z">
          <div class="max-w-6xl mx-auto px-5 py-10">
            <div class="flex items-center justify-between gap-4 mb-8 flex-wrap">
              <div>
                <h2 class="font-bold tracking-tight text-3xl">Your <span class="grad-text">Dashboard</span></h2>
                <p id="dashboard-subtitle" class="text-sm mt-2" style="color:var(--text-muted)">Stored analyses, assessments, and activity tied to your account.</p>
              </div>
              <button class="btn btn-primary" onclick="goHome()"><i class="fas fa-plus"></i> New Analysis</button>
            </div>
            <div id="dashboard-content"></div>
          </div>
        </section>

        <section id="pg-admin" class="pg z">
          <div class="max-w-6xl mx-auto px-5 py-10">
            <div class="flex items-center justify-between gap-4 mb-8 flex-wrap">
              <div>
                <h2 class="font-bold tracking-tight text-3xl">Admin <span class="grad-text">Tracking</span></h2>
                <p class="text-sm mt-2" style="color:var(--text-muted)">Registration trends, user activity, analyses, assessments, and account-level inspection.</p>
              </div>
              <button class="btn btn-ghost" onclick="showUserDashboard()"><i class="fas fa-arrow-left"></i> Back to Dashboard</button>
            </div>
            <div id="admin-content"></div>
          </div>
        </section>
      `);
    }
  }

  function setAuthError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function clearAuthError(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function renderAuth() {
    const guest = document.getElementById("auth-guest");
    const userWrap = document.getElementById("auth-user");
    const dashTab = document.getElementById("dashboard-tab");
    const adminTab = document.getElementById("admin-tab");
    if (!guest || !userWrap || !dashTab || !adminTab) return;

    if (currentUser) {
      guest.classList.add("hidden");
      userWrap.classList.remove("hidden");
      userWrap.classList.add("flex");
      dashTab.classList.remove("hidden");
      adminTab.classList.toggle("hidden", !currentUser.is_admin);
      document.getElementById("auth-avatar").textContent = (currentUser.first_name || "S")[0].toUpperCase();
      document.getElementById("auth-name").textContent = currentUser.name || currentUser.email;
      document.getElementById("dashboard-subtitle").textContent = `Signed in as ${currentUser.name || currentUser.email}.`;
    } else {
      guest.classList.remove("hidden");
      userWrap.classList.add("hidden");
      userWrap.classList.remove("flex");
      dashTab.classList.add("hidden");
      adminTab.classList.add("hidden");
    }
  }

  async function loadCurrentUser() {
    try {
      const data = await api("/api/auth/me", { headers: {} });
      currentUser = data.user || null;
    } catch (_) {
      currentUser = null;
    }
    renderAuth();
    return currentUser;
  }

  function requireAuth() {
    if (currentUser) return true;
    if (typeof showPg === "function") showPg("login");
    return false;
  }

  function requireAdmin() {
    if (currentUser && currentUser.is_admin) return true;
    if (typeof showPg === "function") showPg("login");
    return false;
  }

  window.doRegister = async function doRegister() {
    clearAuthError("register-error");
    try {
      const payload = {
        first_name: document.getElementById("register-first-name").value.trim(),
        last_name: document.getElementById("register-last-name").value.trim(),
        email: document.getElementById("register-email").value.trim(),
        password: document.getElementById("register-password").value
      };
      const data = await api("/api/auth/register", { method: "POST", body: JSON.stringify(payload) });
      currentUser = data.user;
      renderAuth();
      if (typeof goHome === "function") goHome();
    } catch (err) {
      setAuthError("register-error", err.message);
    }
  };

  window.doLogin = async function doLogin() {
    clearAuthError("login-error");
    try {
      const payload = {
        email: document.getElementById("login-email").value.trim(),
        password: document.getElementById("login-password").value
      };
      const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
      currentUser = data.user;
      renderAuth();
      if (currentUser.is_admin) await window.showAdminDashboard();
      else if (typeof goHome === "function") goHome();
    } catch (err) {
      setAuthError("login-error", err.message);
    }
  };

  window.logoutUser = async function logoutUser() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    currentUser = null;
    renderAuth();
    if (typeof showPg === "function") showPg("login");
  };

  function historyBadge(value, cls = "bdg-teal") {
    return `<span class="bdg ${cls}">${esc(value)}</span>`;
  }

  window.showUserDashboard = async function showUserDashboard() {
    if (!requireAuth()) return;
    const content = document.getElementById("dashboard-content");
    content.innerHTML = `<div class="glass p-6"><div class="flex items-center gap-3"><div class="spinner"></div><span class="text-sm">Loading your dashboard...</span></div></div>`;
    if (typeof showPg === "function") showPg("dashboard");
    const data = await api("/api/user/dashboard", { headers: {} });
    const stats = data.stats || {};
    const analyses = data.analyses || [];
    const assessments = data.assessments || [];
    content.innerHTML = `
      <div class="grid md:grid-cols-4 gap-4 mb-6">
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--teal)">${stats.analysis_count || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Analyses</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--blue)">${stats.assessment_count || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Assessments</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--green)">${stats.chat_count || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Career chats</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--purple)">${stats.interview_count || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Interview sessions</p></div>
      </div>
      <div class="grid lg:grid-cols-2 gap-4">
        <div class="glass p-6">
          <div class="flex items-center justify-between mb-4"><h3 class="font-bold text-lg">Recent Analyses</h3>${historyBadge(`${analyses.length} saved`)}</div>
          <div class="space-y-3">
            ${analyses.length ? analyses.map(item => `
              <div class="p-4 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)">
                <div class="flex items-center justify-between gap-3 mb-1">
                  <p class="font-semibold text-sm">${esc(item.job_title || "Target role")}</p>
                  <span class="bdg bdg-teal">${item.match_score || 0}% match</span>
                </div>
                <p class="text-xs" style="color:var(--text-muted)">Readiness ${item.readiness_score || 0}% · ${esc(item.role_category || "Custom")} · ${new Date(item.created_at).toLocaleString()}</p>
              </div>`).join("") : `<p class="text-sm" style="color:var(--text-muted)">No stored analyses yet.</p>`}
          </div>
        </div>
        <div class="glass p-6">
          <div class="flex items-center justify-between mb-4"><h3 class="font-bold text-lg">Assessment History</h3>${historyBadge(`${assessments.length} attempts`, "bdg-blue")}</div>
          <div class="space-y-3">
            ${assessments.length ? assessments.map(item => `
              <div class="p-4 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)">
                <div class="flex items-center justify-between gap-3 mb-1">
                  <p class="font-semibold text-sm">${esc(item.role || "Assessment")}</p>
                  <span class="bdg ${item.score >= 80 ? "bdg-green" : item.score >= 60 ? "bdg-blue" : "bdg-red"}">${item.score || 0}%</span>
                </div>
                <p class="text-xs" style="color:var(--text-muted)">${esc(item.difficulty || "intermediate")} · ${item.correct_answers || 0}/${item.total_questions || 0} correct · ${new Date(item.created_at).toLocaleString()}</p>
              </div>`).join("") : `<p class="text-sm" style="color:var(--text-muted)">No assessments recorded yet.</p>`}
          </div>
        </div>
      </div>`;
  };

  window.showAdminDashboard = async function showAdminDashboard() {
    if (!requireAdmin()) return;
    const content = document.getElementById("admin-content");
    content.innerHTML = `<div class="glass p-6"><div class="flex items-center gap-3"><div class="spinner"></div><span class="text-sm">Loading admin activity...</span></div></div>`;
    if (typeof showPg === "function") showPg("admin");
    const data = await api("/api/admin/dashboard", { headers: {} });
    const totals = data.totals || {};
    content.innerHTML = `
      <div class="grid md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--teal)">${totals.users || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Users</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--purple)">${totals.admins || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Admins</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--blue)">${totals.analyses || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Analyses</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--green)">${totals.assessments || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Assessments</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--amber)">${totals.chats || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Chats</p></div>
        <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--red)">${totals.interviews || 0}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Interviews</p></div>
      </div>
      <div class="grid lg:grid-cols-2 gap-4 mb-4">
        <div class="glass p-6">
          <div class="flex items-center justify-between mb-4"><h3 class="font-bold text-lg">Recent Registrations</h3>${historyBadge(data.default_admin?.email || "admin seeded", "bdg-purple")}</div>
          <div class="space-y-3">
            ${(data.recent_users || []).map(user => `
              <button class="w-full text-left p-4 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)" onclick="loadAdminUser(${user.id})">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="font-semibold text-sm">${esc(`${user.first_name} ${user.last_name}`)}</p>
                    <p class="text-xs" style="color:var(--text-muted)">${esc(user.email)}</p>
                  </div>
                  <span class="bdg ${user.is_admin ? "bdg-purple" : "bdg-teal"}">${user.is_admin ? "Admin" : "User"}</span>
                </div>
                <p class="text-xs mt-2" style="color:var(--text-muted)">Created ${new Date(user.created_at).toLocaleString()} · Last login ${user.last_login ? new Date(user.last_login).toLocaleString() : "Never"}</p>
              </button>`).join("")}
          </div>
        </div>
        <div class="glass p-6">
          <div class="flex items-center justify-between mb-4"><h3 class="font-bold text-lg">Recent Analyses</h3>${historyBadge(`${(data.recent_analyses || []).length} latest`, "bdg-blue")}</div>
          <div class="space-y-3">
            ${(data.recent_analyses || []).map(item => `
              <div class="p-4 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)">
                <div class="flex items-center justify-between gap-3 mb-1">
                  <p class="font-semibold text-sm">${esc(item.job_title || "Target role")}</p>
                  <span class="bdg bdg-teal">${item.match_score || 0}%</span>
                </div>
                <p class="text-xs" style="color:var(--text-muted)">${esc(item.user_name || item.email || "Unknown")} · readiness ${item.readiness_score || 0}% · ${new Date(item.created_at).toLocaleString()}</p>
              </div>`).join("")}
          </div>
        </div>
      </div>
      <div class="glass p-6 mb-4">
        <div class="flex items-center justify-between mb-4"><h3 class="font-bold text-lg">User Activity</h3>${historyBadge("Click a user for detail", "bdg-amber")}</div>
        <div class="space-y-3">
          ${(data.user_activity || []).map(item => `
            <button class="w-full text-left p-4 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)" onclick="loadAdminUser(${item.id})">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="font-semibold text-sm">${esc(item.user_name || "Unknown")}</p>
                  <p class="text-xs" style="color:var(--text-muted)">${esc(item.email || "")}</p>
                </div>
                <div class="flex gap-2 flex-wrap justify-end">
                  <span class="bdg bdg-teal">${item.analyses_count || 0} analyses</span>
                  <span class="bdg bdg-blue">${item.assessments_count || 0} assessments</span>
                </div>
              </div>
            </button>`).join("")}
        </div>
      </div>
      <div id="admin-user-detail"></div>`;
  };

  window.loadAdminUser = async function loadAdminUser(userId) {
    const detail = document.getElementById("admin-user-detail");
    detail.innerHTML = `<div class="glass p-6"><div class="flex items-center gap-3"><div class="spinner"></div><span class="text-sm">Loading user detail...</span></div></div>`;
    const data = await api(`/api/admin/users/${userId}`, { headers: {} });
    detail.innerHTML = `
      <div class="glass p-6">
        <div class="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h3 class="font-bold text-xl">${esc(data.user.name)}</h3>
            <p class="text-sm" style="color:var(--text-muted)">${esc(data.user.email)} · Joined ${new Date(data.user.created_at).toLocaleString()}</p>
          </div>
          <span class="bdg ${data.user.is_admin ? "bdg-purple" : "bdg-teal"}">${data.user.is_admin ? "Admin account" : "Standard user"}</span>
        </div>
        <div class="grid lg:grid-cols-2 gap-4">
          <div>
            <h4 class="font-semibold mb-3">Analyses</h4>
            <div class="space-y-3">${(data.analyses || []).map(item => `<div class="p-3 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)"><p class="font-semibold text-sm">${esc(item.job_title || "Target role")}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Match ${item.match_score || 0}% · Readiness ${item.readiness_score || 0}% · ${new Date(item.created_at).toLocaleString()}</p></div>`).join("") || `<p class="text-sm" style="color:var(--text-muted)">No analyses stored.</p>`}</div>
          </div>
          <div>
            <h4 class="font-semibold mb-3">Assessments</h4>
            <div class="space-y-3">${(data.assessments || []).map(item => `<div class="p-3 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)"><p class="font-semibold text-sm">${esc(item.role || "Assessment")}</p><p class="text-xs mt-1" style="color:var(--text-muted)">${esc(item.difficulty || "intermediate")} · ${item.score || 0}% · ${item.correct_answers || 0}/${item.total_questions || 0} · ${new Date(item.created_at).toLocaleString()}</p></div>`).join("") || `<p class="text-sm" style="color:var(--text-muted)">No assessments stored.</p>`}</div>
          </div>
        </div>
      </div>`;
  };

  function wrapProtectedFunctions() {
    const protectedNames = ["runAnalysis", "startAssessment", "submitAssessment", "startInterview", "sendInterviewMsg", "getInterviewFeedback"];
    protectedNames.forEach(name => {
      const original = window[name];
      if (typeof original !== "function" || original.__authWrapped) return;
      const wrapped = function (...args) {
        if (!requireAuth()) return;
        return original.apply(this, args);
      };
      wrapped.__authWrapped = true;
      window[name] = wrapped;
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    appendUi();
    wrapProtectedFunctions();
    await loadCurrentUser();
    if (!currentUser && typeof showPg === "function") showPg("login");
  });
})();
