(function () {
  let radarChart = null;
  let progressChart = null;
  let lastAssessment = null;
  let difficulty = "intermediate";
  let timerHandle = null;
  const roleCatalog = {
    Tech: [
      "Software Engineer",
      "Data Analyst",
      "Data Scientist",
      "Machine Learning Engineer",
      "Frontend Developer",
      "Backend Developer",
      "DevOps Engineer",
      "Cybersecurity Analyst",
      "Cloud Engineer",
      "AI Engineer"
    ],
    "Non-Tech": [
      "Business Analyst",
      "Marketing Manager",
      "Sales Executive",
      "HR Manager",
      "Product Manager",
      "Operations Manager",
      "Financial Analyst",
      "Accountant",
      "Customer Success Manager",
      "Project Manager"
    ]
  };
  const originalRenderResults = window.renderResults;
  const originalRunAnalysis = window.runAnalysis;

  function historyKey() { return "sb_history_guest"; }
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(historyKey()) || "[]"); } catch (_) { return []; }
  }
  function currentRolePayload() {
    const selectedRole = byId("role-select") ? byId("role-select").value : "";
    const customRole = byId("custom-role") ? byId("custom-role").value.trim() : "";
    const roleCategory = byId("role-category") ? byId("role-category").value : "Tech";
    const finalRole = selectedRole === "Other (Enter manually)" ? customRole : selectedRole;
    return {
      role_category: roleCategory,
      selected_role: selectedRole,
      custom_role: customRole,
      final_role: finalRole || (byId("jt") ? byId("jt").value.trim() : "")
    };
  }
  function saveHistory(data) {
    const item = {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      job_title: data.job_title || "Career analysis",
      match: Number(data.overall_match || 0),
      readiness: Number(data.apply_readiness || data.overall_match || 0),
      gaps: (data.gaps || []).length,
      assessment: null,
      analysis: data
    };
    localStorage.setItem(historyKey(), JSON.stringify([item].concat(getHistory()).slice(0, 12)));
  }
  function updateLatestHistoryAssessment(result) {
    const history = getHistory();
    if (!history.length || !latestAnalysisData) return;
    history[0].assessment = result;
    history[0].analysis = latestAnalysisData;
    localStorage.setItem(historyKey(), JSON.stringify(history));
  }
  async function postJson(url, payload) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
    const data = await readJsonSafe(res);
    if (!res.ok || data.error) throw new Error(data.error || "Server error");
    return data;
  }
  function cvText() {
    return byId("cv-txt").value.trim() || (latestAnalysisData && latestAnalysisData._input && latestAnalysisData._input.cv_text) || "";
  }
  function skillsForRadar(data) {
    const rows = new Map();
    (data.required_skills || []).forEach(s => rows.set(s.skill, { skill: s.skill, required: Number(s.level || 80), current: 0 }));
    (data.current_skills || data.strengths || []).forEach(s => {
      const row = rows.get(s.skill) || { skill: s.skill, required: 70, current: 0 };
      row.current = Number(s.level || 0);
      rows.set(s.skill, row);
    });
    (data.gaps || []).forEach(g => {
      if (!rows.has(g.skill)) rows.set(g.skill, { skill: g.skill, required: g.importance === "critical" ? 90 : 75, current: 25 });
    });
    return Array.from(rows.values()).slice(0, 8);
  }
  function initializeRoleSelectors() {
    const categoryEl = byId("role-category");
    const roleEl = byId("role-select");
    if (!categoryEl || !roleEl) return;
    if (!categoryEl.value) categoryEl.value = "Tech";
    updateRoleOptions();
  }

  window.updateRoleOptions = function () {
    const categoryEl = byId("role-category");
    const roleEl = byId("role-select");
    if (!categoryEl || !roleEl) return;
    const roles = (roleCatalog[categoryEl.value] || []).concat(["Other (Enter manually)"]);
    const current = roleEl.value;
    roleEl.innerHTML = roles.map(role => `<option value="${safe(role)}">${safe(role)}</option>`).join("");
    roleEl.value = roles.includes(current) ? current : roles[0];
    window.handleRoleSelection();
  };

  window.handleRoleSelection = function () {
    const payload = currentRolePayload();
    const customWrap = byId("custom-role-wrap");
    if (customWrap) customWrap.classList.toggle("hidden", payload.selected_role !== "Other (Enter manually)");
    const finalRole = payload.selected_role === "Other (Enter manually)" ? payload.custom_role : payload.selected_role;
    if (finalRole && byId("jt") && (!byId("jt").value.trim() || document.activeElement !== byId("jt"))) {
      byId("jt").value = finalRole;
    }
  };

  window.setAssessmentDifficulty = function (level) {
    difficulty = level;
    ["beginner", "intermediate", "advanced"].forEach(item => {
      const el = byId("assessment-diff-" + item);
      if (el) el.classList.toggle("on", item === level);
    });
  };

  window.runAnalysis = async function () {
    const payload = currentRolePayload();
    if (payload.final_role && byId("jt") && !byId("jt").value.trim()) byId("jt").value = payload.final_role;
    const originalFetch = window.fetch;
    window.fetch = function (url, options) {
      if (url === "/api/analyse" && options && options.body instanceof FormData) {
        options.body.append("role_category", payload.role_category);
        options.body.append("selected_role", payload.selected_role);
        options.body.append("custom_role", payload.custom_role);
      }
      return originalFetch.apply(this, arguments);
    };
    try {
      await originalRunAnalysis();
      if (latestAnalysisData) saveHistory(latestAnalysisData);
    } finally {
      window.fetch = originalFetch;
    }
  };

  window.renderResults = function (data) {
    originalRenderResults(data);
    byId("rc").insertAdjacentHTML("beforeend", extraSections(data));
    setTimeout(() => {
      drawRadar(data);
      drawProgress();
      renderHistory();
    }, 100);
  };

  function extraSections(data) {
    const readiness = Number(data.apply_readiness || data.overall_match || 0);
    const status = readiness >= 75 ? "bdg-green" : readiness >= 50 ? "bdg-blue" : "bdg-red";
    const statusText = readiness >= 75 ? "Ready" : readiness >= 50 ? "Almost ready" : "Needs focus";
    return `
      <div class="grid lg:grid-cols-3 gap-4 mt-5 mb-5">
        <div class="glass p-6">
          <div class="sec-h"><div class="sec-ic" style="background:var(--green-dim)"><i class="fas fa-clipboard-check" style="color:var(--green)"></i></div>Apply Readiness</div>
          <p class="font-bold text-4xl mb-2">${readiness}%</p>
          <span class="bdg ${status}">${statusText}</span>
          <div class="space-y-2 mt-4">${(data.readiness_improvements || data.next_steps || []).slice(0, 3).map(x => `<p class="text-sm" style="color:var(--text-muted)"><i class="fas fa-arrow-right mr-2" style="color:var(--teal)"></i>${safe(x)}</p>`).join("")}</div>
        </div>
        <div class="glass p-6 lg:col-span-2">
          <div class="sec-h"><div class="sec-ic" style="background:var(--blue-dim)"><i class="fas fa-chart-line" style="color:var(--blue)"></i></div>Progress Dashboard</div>
          <canvas id="progressChart" height="110"></canvas>
        </div>
      </div>
      <div class="grid lg:grid-cols-2 gap-4 mb-5">
        <div class="glass p-6">
          <div class="sec-h"><div class="sec-ic" style="background:var(--teal-dim)"><i class="fas fa-chart-pie" style="color:var(--teal)"></i></div>Skill Radar Chart</div>
          <canvas id="skillRadar" height="260"></canvas>
        </div>
        <div class="glass p-6">
          <div class="sec-h"><div class="sec-ic" style="background:var(--teal-dim)"><i class="fas fa-file-arrow-down" style="color:var(--teal)"></i></div>Report & CV Tools</div>
          <div class="flex flex-wrap gap-3 mb-4">
            <button class="btn btn-primary" onclick="downloadReport()"><i class="fas fa-download"></i> Download Report</button>
            <button class="btn btn-ghost" onclick="rewriteCv()"><i class="fas fa-file-pen"></i> Improve My CV</button>
          </div>
          <div id="cvRewriteBox"></div>
        </div>
      </div>
      <div class="grid lg:grid-cols-2 gap-4 mb-5">
        <div class="glass p-6">
          <div class="sec-h"><div class="sec-ic" style="background:var(--blue-dim)"><i class="fas fa-comments" style="color:var(--blue)"></i></div>AI Chatbot</div>
          <div id="chatLog" class="space-y-3 mb-4" style="max-height:280px;overflow:auto"></div>
          <div class="flex gap-2"><input id="chatInput" class="inp" placeholder="Ask a career question..." onkeydown="if(event.key==='Enter')sendChat()"><button class="btn btn-primary" onclick="sendChat()"><i class="fas fa-paper-plane"></i></button></div>
        </div>
        <div class="glass p-6">
          <div class="sec-h"><div class="sec-ic" style="background:var(--green-dim)"><i class="fas fa-clock-rotate-left" style="color:var(--green)"></i></div>User History</div>
          <div id="historyBox" class="space-y-3"></div>
        </div>
      </div>
      <div id="adaptiveWrap" class="glass p-6 mb-5 hidden">
        <div class="sec-h"><div class="sec-ic" style="background:var(--teal-dim)"><i class="fas fa-route" style="color:var(--teal)"></i></div>Adaptive Roadmap</div>
        <div id="adaptiveRoadmap"></div>
      </div>`;
  }

  function drawRadar(data) {
    if (!window.Chart || !byId("skillRadar")) return;
    const rows = skillsForRadar(data);
    if (radarChart) radarChart.destroy();
    radarChart = new Chart(byId("skillRadar"), {
      type: "radar",
      data: {
        labels: rows.map(r => r.skill),
        datasets: [
          { label: "Required", data: rows.map(r => r.required), borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,.14)" },
          { label: "Current", data: rows.map(r => r.current), borderColor: "#2dd4bf", backgroundColor: "rgba(45,212,191,.14)" }
        ]
      },
      options: { scales: { r: { min: 0, max: 100, ticks: { color: "#94a3b8", backdropColor: "transparent" }, grid: { color: "rgba(255,255,255,.08)" }, pointLabels: { color: "#f1f5f9" } } }, plugins: { legend: { labels: { color: "#94a3b8" } } } }
    });
  }

  function drawProgress() {
    if (!window.Chart || !byId("progressChart")) return;
    const hist = getHistory().slice().reverse();
    if (progressChart) progressChart.destroy();
    progressChart = new Chart(byId("progressChart"), {
      type: "line",
      data: {
        labels: hist.map((_, i) => `Run ${i + 1}`),
        datasets: [
          { label: "Match", data: hist.map(h => h.match), borderColor: "#2dd4bf", tension: .35 },
          { label: "Readiness", data: hist.map(h => h.readiness), borderColor: "#10b981", tension: .35 },
          { label: "Assessment", data: hist.map(h => h.assessment ? h.assessment.score : null), borderColor: "#3b82f6", tension: .35 }
        ]
      },
      options: { scales: { y: { min: 0, max: 100, ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,.08)" } }, x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,.04)" } } }, plugins: { legend: { labels: { color: "#94a3b8" } } } }
    });
  }

  function renderHistory() {
    const box = byId("historyBox");
    if (!box) return;
    const hist = getHistory();
    box.innerHTML = hist.length ? hist.slice(0, 5).map(h => `
      <button class="w-full text-left p-3 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)" onclick="loadHistory('${h.id}')">
        <div class="flex items-center justify-between gap-3"><span class="font-semibold text-sm">${safe(h.job_title)}</span><span class="bdg bdg-teal">${h.match}%</span></div>
        <p class="text-xs mt-1" style="color:var(--text-muted)">${new Date(h.date).toLocaleString()} � ${h.gaps} gaps${h.assessment ? ` � Assessment ${h.assessment.score}%` : ""}</p>
      </button>`).join("") : '<p class="text-sm" style="color:var(--text-muted)">Your previous results will appear here.</p>';
  }
  window.loadHistory = function (id) {
    const item = getHistory().find(h => h.id === id);
    if (item) {
      latestAnalysisData = item.analysis;
      lastAssessment = item.assessment || null;
      renderResults(item.analysis);
      showPg("results");
      if (lastAssessment) renderAssessmentSummary(lastAssessment);
    }
  };

  window.fetchJobUrl = async function () {
    const url = byId("job-url").value.trim();
    if (!url) return showErr("Paste a job URL first.");
    const btn = byId("fetch-job-btn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching';
    try {
      const data = await postJson("/api/fetch-job-url", { url });
      if (data.title && !byId("jt").value.trim()) byId("jt").value = data.title.slice(0, 120);
      byId("jd").value = data.description || "";
    } catch (e) {
      showErr(e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-cloud-arrow-down"></i> Fetch Job';
    }
  };

  function clearAssessmentTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
    if (byId("assessment-timer-wrap")) byId("assessment-timer-wrap").classList.add("hidden");
    if (byId("assessment-timer")) byId("assessment-timer").textContent = "Timer 00:00";
  }

  function addAssessmentTimer(minutes) {
    clearAssessmentTimer();
    const wrap = byId("assessment-timer-wrap");
    const label = byId("assessment-timer");
    if (!wrap || !label) return;
    wrap.classList.remove("hidden");
    const end = Date.now() + minutes * 60000;
    timerHandle = setInterval(() => {
      const left = Math.max(0, end - Date.now());
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      label.textContent = `Timer ${m}:${String(s).padStart(2, "0")}`;
      if (left <= 0) {
        clearAssessmentTimer();
        submitAssessment();
      }
    }, 1000);
  }

  function renderAssessmentSummary(result) {
    byId("assessment-score-value").textContent = `${Number(result.score || 0)}%`;
    const feedback = byId("assessment-feedback");
    feedback.textContent = result.feedback || "";
    feedback.classList.toggle("hidden", !result.feedback);

    const weakSkills = byId("assessment-weak-skills");
    const weak = Array.isArray(result.weak_skills) ? result.weak_skills : [];
    weakSkills.innerHTML = weak.length
      ? `<p class="text-xs font-semibold uppercase tracking-wide mb-2" style="color:var(--text)">Weak Skills</p><div class="flex flex-wrap gap-2">${weak.map(skill => `<span class="bdg bdg-red">${safe(skill)}</span>`).join("")}</div>`
      : "";
    weakSkills.classList.toggle("hidden", !weak.length);

    const scoreWrap = byId("assessment-skill-scores");
    const skillScores = Array.isArray(result.skill_scores) ? result.skill_scores : [];
    scoreWrap.innerHTML = skillScores.length
      ? `<p class="text-xs font-semibold uppercase tracking-wide" style="color:var(--text)">Skill-wise scoring</p>${skillScores.map(item => `
          <div>
            <div class="flex items-center justify-between mb-2"><span class="text-sm font-semibold" style="color:var(--text)">${safe(item.skill)}</span><span class="text-sm font-bold">${Number(item.score || 0)}%</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${Number(item.score || 0)}%"></div></div>
          </div>`).join("")}`
      : "";
    scoreWrap.classList.toggle("hidden", !skillScores.length);
    byId("assessment-score").classList.remove("hidden");
  }

  window.startAssessment = async function () {
    byId("assessment-error").classList.add("hidden");
    byId("assessment-score").classList.add("hidden");
    byId("assessment-questions").innerHTML = "";
    byId("assessment-submit-btn").classList.add("hidden");
    byId("assessment-loading").classList.remove("hidden");
    byId("assessment-start-btn").disabled = true;
    clearAssessmentTimer();
    try {
      const rolePayload = currentRolePayload();
      const role = (latestAnalysisData && latestAnalysisData.job_title) || rolePayload.final_role || byId("jt").value.trim() || "Target role";
      const data = await postJson("/api/assessment/start", {
        role,
        role_category: rolePayload.role_category,
        selected_role: rolePayload.selected_role,
        custom_role: rolePayload.custom_role,
        analysis: latestAnalysisData || {},
        skills: skillsForRadar(latestAnalysisData || {}).map(r => r.skill),
        difficulty
      });
      lastAssessment = data;
      assessmentQuestions = Array.isArray(data.questions) ? data.questions : [];
      if (!assessmentQuestions.length) throw new Error("No assessment questions were returned.");
      byId("assessment-loading").classList.add("hidden");
      byId("assessment-start-wrap").classList.add("hidden");
      renderAssessmentQuestions(assessmentQuestions);
      byId("assessment-submit-btn").classList.remove("hidden");
      addAssessmentTimer(Number(data.duration_minutes || 8));
    } catch (e) {
      byId("assessment-loading").classList.add("hidden");
      byId("assessment-start-btn").disabled = false;
      setAssessmentError(e.message || "Failed to start assessment.");
    }
  };

  window.submitAssessment = async function () {
    if (!assessmentQuestions.length) return setAssessmentError("Start assessment first.");
    byId("assessment-error").classList.add("hidden");
    const answers = assessmentQuestions.map((q, i) => {
      const selected = document.querySelector(`input[name="assessment-q-${i}"]:checked`);
      return {
        question: q.question || q.text || "",
        skill: q.skill || "General",
        explanation: q.explanation || "",
        selected: selected ? selected.value : "",
        correct: q.correct || ""
      };
    });
    if (answers.some(a => !a.selected)) return setAssessmentError("Please answer all questions.");
    byId("assessment-submit-btn").disabled = true;
    try {
      clearAssessmentTimer();
      const result = await postJson("/api/assessment/evaluate", { answers });
      lastAssessment = Object.assign({}, result, { completed_at: new Date().toISOString(), difficulty });
      renderAssessmentSummary(lastAssessment);
      updateLatestHistoryAssessment(lastAssessment);
      await adaptRoadmap(lastAssessment);
    } catch (e) {
      setAssessmentError(e.message || "Failed to submit assessment.");
    } finally {
      byId("assessment-submit-btn").disabled = false;
    }
  };

  async function adaptRoadmap(result) {
    const wrap = byId("adaptiveWrap");
    const box = byId("adaptiveRoadmap");
    if (!wrap || !box || !latestAnalysisData) return;
    wrap.classList.remove("hidden");
    box.innerHTML = '<div class="flex items-center gap-3"><div class="spinner"></div><span class="text-sm">Adapting roadmap...</span></div>';
    try {
      const data = await postJson("/api/adaptive-roadmap", { analysis: latestAnalysisData, assessment: result });
      box.innerHTML = `${data.focus_summary ? `<p class="text-sm mb-4" style="color:var(--text-muted)">${safe(data.focus_summary)}</p>` : ""}
        <div class="space-y-3">${(data.roadmap || []).map((s, i) => `<div class="p-4 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)"><p class="font-semibold">${i + 1}. ${safe(s.title || "Step")}</p><p class="text-sm mt-1" style="color:var(--text-muted)">${safe(s.why || "")}</p><span class="bdg bdg-teal mt-2">${safe(s.duration || "Next")}</span></div>`).join("")}</div>`;
    } catch (e) {
      box.innerHTML = `<p class="text-sm" style="color:var(--red)">${safe(e.message)}</p>`;
    }
  }

  window.rewriteCv = async function () {
    const box = byId("cvRewriteBox");
    box.innerHTML = '<div class="flex items-center gap-3"><div class="spinner"></div><span class="text-sm">Improving CV...</span></div>';
    try {
      const data = await postJson("/api/rewrite-cv", { cv_text: cvText(), analysis: latestAnalysisData || {} });
      box.innerHTML = `<textarea class="inp" rows="10">${safe(data.rewritten_cv || "")}</textarea>
        <div class="flex flex-wrap gap-2 mt-3">${(data.keywords || []).slice(0, 10).map(k => `<span class="bdg bdg-teal">${safe(k)}</span>`).join("")}</div>`;
    } catch (e) {
      box.innerHTML = `<p class="text-sm" style="color:var(--red)">${safe(e.message)}</p>`;
    }
  };

  window.sendChat = async function () {
    const input = byId("chatInput");
    const log = byId("chatLog");
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    log.insertAdjacentHTML("beforeend", `<div class="p-3 rounded-xl ml-8" style="background:var(--blue-dim);border:1px solid var(--border)"><p class="text-sm">${safe(message)}</p></div>`);
    const pending = document.createElement("div");
    pending.className = "p-3 rounded-xl mr-8";
    pending.style = "background:rgba(255,255,255,.03);border:1px solid var(--border)";
    pending.innerHTML = '<div class="flex items-center gap-2"><div class="spinner"></div><span class="text-sm">Thinking...</span></div>';
    log.appendChild(pending);
    try {
      const data = await postJson("/api/chat", { message, analysis: latestAnalysisData || {}, assessment: lastAssessment || {} });
      pending.innerHTML = `<p class="text-sm leading-relaxed" style="color:var(--text-muted)">${safe(data.text || "")}</p>`;
    } catch (e) {
      pending.innerHTML = `<p class="text-sm" style="color:var(--red)">${safe(e.message)}</p>`;
    }
    log.scrollTop = log.scrollHeight;
  };

  window.downloadReport = function () {
    const container = byId("pg-results");
    if (!container) return;
    if (!window.html2pdf) return window.print();
    html2pdf().set({
      margin: .35,
      filename: `SkillBridge-${((latestAnalysisData && latestAnalysisData.job_title) || "report").replace(/[^a-z0-9]+/gi, "-")}.pdf`,
      image: { type: "jpeg", quality: .98 },
      html2canvas: { scale: 2, backgroundColor: "#0a0c10" },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" }
    }).from(container).save();
  };

  initializeRoleSelectors();
})();

