/**
 * SkillBridge AI — skillbridge.js
 * Handles: analysis, assessment, answers review, AI interview (text + voice)
 */

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
let latestAnalysisData   = null;
let assessmentQuestions  = [];
let assessmentAnswers    = [];
let assessmentSubmitted  = false;
let assessmentDifficulty = "intermediate";
let loadingInterval      = null;

// Interview state
let interviewHistory   = [];
let interviewQIndex    = 0;
let interviewFinished  = false;
let interviewVoiceMode = false;
let speechRecognition  = null;
let speechSynthesisApi = window.speechSynthesis || null;
let voiceActive        = false;
let currentUtterance   = null;

// ═══════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════
const loadingMessages = [
  "Parsing your CV...", "Identifying your skills...", "Analysing job requirements...",
  "Calculating skill gaps...", "Finding recommended courses...", "Building learning roadmap...",
  "Fetching salary insights in ₹...", "Almost done..."
];

const platformIcons = {
  coursera:         { icon: "fa-graduation-cap", color: "#0056D2", label: "Coursera" },
  udemy:            { icon: "fa-circle-play",     color: "#A435F0", label: "Udemy" },
  youtube:          { icon: "fa-youtube",         color: "#FF0000", label: "YouTube" },
  freecodecamp:     { icon: "fa-code",            color: "#0a0a23", label: "freeCodeCamp" },
  "free code camp": { icon: "fa-code",            color: "#0a0a23", label: "freeCodeCamp" },
  edx:              { icon: "fa-school",          color: "#02262B", label: "edX" },
  linkedin:         { icon: "fa-linkedin",        color: "#0077B5", label: "LinkedIn Learning" },
  pluralsight:      { icon: "fa-play",            color: "#F15B2A", label: "Pluralsight" },
  datacamp:         { icon: "fa-database",        color: "#03EF62", label: "DataCamp" },
  google:           { icon: "fa-google",          color: "#4285F4", label: "Google" },
  microsoft:        { icon: "fa-microsoft",       color: "#00A4EF", label: "Microsoft" },
  kaggle:           { icon: "fa-chart-line",      color: "#20BEFF", label: "Kaggle" },
  default:          { icon: "fa-link",            color: "#2dd4bf", label: "Course" }
};

const roleCatalog = {
  Tech: [
    "Software Engineer","Data Analyst","Data Scientist","Machine Learning Engineer",
    "Frontend Developer","Backend Developer","DevOps Engineer","Cybersecurity Analyst",
    "Cloud Engineer","AI Engineer"
  ],
  "Non-Tech": [
    "Business Analyst","Marketing Manager","Sales Executive","HR Manager",
    "Product Manager","Operations Manager","Financial Analyst","Accountant",
    "Customer Success Manager","Project Manager"
  ]
};

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function byId(id) { return document.getElementById(id); }

function safe(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function getPlatformInfo(name, url) {
  const t = (name + " " + url).toLowerCase();
  for (const [k, v] of Object.entries(platformIcons)) {
    if (k !== "default" && t.includes(k)) return v;
  }
  return platformIcons.default;
}

async function readJsonSafe(response) {
  const text = await response.text();
  try { return JSON.parse(text || "{}"); }
  catch (_) { return { error: text || "Invalid server response" }; }
}

// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
function showPg(name) {
  document.querySelectorAll(".pg,.pg-center").forEach(p => p.classList.remove("on"));
  const el = byId("pg-" + name);
  if (el) el.classList.add("on");
  document.querySelectorAll('.tab[id^="nt-"]').forEach(t => t.classList.remove("on"));
  const tab = byId("nt-" + name);
  if (tab) tab.classList.add("on");
  window.scrollTo(0, 0);
}

function goHome() { showPg("home"); }

function showErr(msg) {
  const el = byId("err");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideErr() {
  byId("err").classList.add("hidden");
  byId("err").textContent = "";
}

function showResultTab(btn, tabName) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  const panel = byId("tab-" + tabName);
  if (panel) panel.classList.add("active");
  document.querySelectorAll(".result-tab").forEach(t => t.classList.remove("on"));
  if (btn) btn.classList.add("on");
}

function jumpToAnswers() {
  const btn = document.querySelector('.result-tab[data-tab="answers"]');
  showResultTab(btn, "answers");
}

function jumpToAssessment() {
  const btn = document.querySelector('.result-tab[data-tab="assessment"]');
  showResultTab(btn, "assessment");
}

// ═══════════════════════════════════════════════════
// ROLE SELECTORS
// ═══════════════════════════════════════════════════
function updateRoleOptions() {
  const c = byId("role-category"), r = byId("role-select");
  if (!c || !r) return;
  const cat = c.value;
  if (!cat) {
    r.innerHTML = '<option value="" disabled selected>Select a category first...</option>';
    return;
  }
  const roles = (roleCatalog[cat] || []).concat(["Other (Enter manually)"]);
  r.innerHTML = '<option value="" disabled selected>Select your role...</option>' +
    roles.map(x => `<option value="${x}">${x}</option>`).join("");
  r.value = "";
  handleRoleSelection();
}

function handleRoleSelection() {
  const s = byId("role-select") ? byId("role-select").value : "";
  const cw = byId("custom-role-wrap");
  if (cw) cw.classList.toggle("hidden", s !== "Other (Enter manually)");
  if (s && s !== "Other (Enter manually)" && byId("jt") && !byId("jt").value.trim()) {
    byId("jt").value = s;
  }
}

// ═══════════════════════════════════════════════════
// LOADING
// ═══════════════════════════════════════════════════
function startLoading() {
  let i = 0;
  byId("ls").textContent = loadingMessages[0];
  loadingInterval = setInterval(() => {
    i = Math.min(i + 1, loadingMessages.length - 1);
    byId("ls").textContent = loadingMessages[i];
  }, 1800);
}

function stopLoading() {
  clearInterval(loadingInterval);
  loadingInterval = null;
}

// ═══════════════════════════════════════════════════
// CONFETTI
// ═══════════════════════════════════════════════════
function fireConfetti() {
  const colors = ["#2dd4bf","#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444","#fff"];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const el = document.createElement("div");
      el.className = "confetti-piece";
      el.style.cssText = `left:${Math.random()*100}vw;top:-10px;background:${colors[Math.floor(Math.random()*colors.length)]};width:${6+Math.random()*6}px;height:${6+Math.random()*6}px;border-radius:${Math.random()>.5?'50%':'2px'};animation-duration:${2+Math.random()*2}s;animation-delay:${Math.random()*.5}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }, i * 30);
  }
}

// ═══════════════════════════════════════════════════
// EXPORT PDF — opens in new tab, uses browser print-to-PDF
// ═══════════════════════════════════════════════════
function exportPDF() {
  if (!latestAnalysisData) { alert("Run an analysis first."); return; }

  const d          = latestAnalysisData;
  const match      = Number(d.overall_match || 0);
  const readiness  = Number(d.apply_readiness || match);
  const strengths  = Array.isArray(d.strengths)             ? d.strengths             : [];
  const gaps       = Array.isArray(d.gaps)                  ? d.gaps                  : [];
  const courses    = Array.isArray(d.recommended_courses)   ? d.recommended_courses   : [];
  const roadmap    = Array.isArray(d.roadmap)               ? d.roadmap               : [];
  const cvAdvice   = Array.isArray(d.cv_advice)             ? d.cv_advice             : [];
  const altRoles   = Array.isArray(d.alternative_roles)     ? d.alternative_roles     : [];
  const salary     = d.salary_insight || {};
  const nextSteps  = Array.isArray(d.next_steps)            ? d.next_steps            : [];
  const careerAdv  = Array.isArray(d.career_advice)         ? d.career_advice         : [];

  const matchColor = match >= 75 ? "#059669" : match >= 50 ? "#2563eb" : "#dc2626";
  const readColor  = readiness >= 75 ? "#059669" : readiness >= 50 ? "#2563eb" : "#dc2626";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])
  );

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
  <title>SkillBridge — ${esc(d.job_title || "Report")}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;background:#fff;color:#1e293b;font-size:13px;line-height:1.6;padding:28px 32px}
    .cover-page{position:relative;min-height:1120px;page-break-after:always;background:#fff}
    .cover-frame-outer,.cover-frame-inner{position:absolute;inset:40px;border:3px solid #111}
    .cover-frame-inner{inset:46px;border-width:1.5px}
    .cover-title{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:'Times New Roman',serif;font-size:54px;font-weight:700;color:#111;text-align:center;white-space:nowrap}
    .cover-page-number{position:absolute;left:50%;bottom:66px;transform:translateX(-50%);font-family:'Times New Roman',serif;font-size:18px;color:#111}
    h2{font-size:15px;font-weight:700;color:#0f172a;margin:22px 0 10px;padding-bottom:5px;border-bottom:2px solid #e2e8f0}
    h3{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px}
    .header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;padding-bottom:18px;border-bottom:3px solid #0d9488}
    .logo{font-size:18px;font-weight:800;color:#0d9488;margin-bottom:4px}
    .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
    .bg{background:#d1fae5;color:#059669}.bb{background:#dbeafe;color:#2563eb}
    .br{background:#fee2e2;color:#dc2626}.ba{background:#fef3c7;color:#d97706}
    .bp{background:#ede9fe;color:#7c3aed}.bt{background:#ccfbf1;color:#0d9488}
    .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
    .metric{border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center}
    .metric .val{font-size:22px;font-weight:800}.metric .lbl{font-size:10px;color:#64748b;text-transform:uppercase;margin-top:2px}
    .bar-track{background:#e2e8f0;border-radius:999px;height:6px;overflow:hidden;margin:4px 0 2px}
    .bar-fill{height:100%;border-radius:999px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px}
    .card{border:1px solid #e2e8f0;border-radius:10px;padding:14px}
    .sk{margin-bottom:10px}
    .gap-item{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:9px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:7px}
    .step-row{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px}
    .num{min-width:24px;height:24px;border-radius:50%;background:#0d9488;color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0}
    .cr{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:9px 11px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:7px}
    .tl{display:flex;gap:12px;margin-bottom:14px}
    .tld{min-width:20px;height:20px;border-radius:50%;background:#0d9488;color:#fff;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0;margin-top:2px}
    .tip{display:flex;gap:10px;align-items:flex-start;padding:9px 11px;border-left:3px solid #0d9488;background:#f8fafc;margin-bottom:7px}
    .adv{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f1f5f9}
    .sal{font-size:24px;font-weight:800;color:#0d9488;text-align:center;padding:16px;border:2px solid #ccfbf1;border-radius:10px;background:#f0fdfa;margin-bottom:12px}
    .sp{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
    .sh{border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:center}
    .rc{border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:18px}
    a{color:#0d9488;text-decoration:none;font-size:11px}
    .footer{margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#94a3b8}
    @media print{
      @page{margin:12mm 14mm}
      body{padding:0}
      h2{page-break-after:avoid}
      .grid2,.metrics,.sp{page-break-inside:avoid}
    }
  </style></head><body>

  <div class="cover-page">
    <div class="cover-frame-outer"></div>
    <div class="cover-frame-inner"></div>
    <div class="cover-title">1.INTRODUCTION</div>
    <div class="cover-page-number">1</div>
  </div>

  <div class="header">
    <div>
      <div class="logo">⚡ SkillBridge AI</div>
      <h1 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px">${esc(d.job_title || "Career Gap Analysis")}</h1>
      <p style="color:#64748b;font-size:12px;margin-top:3px;max-width:520px">${esc(d.summary || "")}</p>
      <div style="margin-top:8px">
        <span class="badge ${match>=75?'bg':match>=50?'bb':'br'}">${match>=75?"Strong Match":match>=50?"Good Foundation":"Needs Work"}</span>
        ${d.industry ? `<span class="badge bt" style="margin-left:4px">${esc(d.industry)}</span>` : ""}
      </div>
    </div>
    <div style="text-align:right;flex-shrink:0;margin-left:20px">
      <div style="font-size:42px;font-weight:800;color:${matchColor};line-height:1">${match}%</div>
      <div style="font-size:11px;color:#64748b">Job Match</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:3px">${new Date().toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'})}</div>
    </div>
  </div>

  <div class="metrics">
    <div class="metric"><div class="val" style="color:${matchColor}">${match}%</div><div class="lbl">Job Match</div></div>
    <div class="metric"><div class="val" style="color:${readColor}">${readiness}%</div><div class="lbl">Readiness</div></div>
    <div class="metric"><div class="val" style="color:#059669">${strengths.length}</div><div class="lbl">Strengths</div></div>
    <div class="metric"><div class="val" style="color:#dc2626">${gaps.length}</div><div class="lbl">Gaps</div></div>
  </div>

  <div class="rc">
    <div style="display:flex;justify-content:space-between;margin-bottom:5px">
      <span style="font-weight:600;font-size:13px">Apply Readiness</span>
      <span style="font-weight:800;color:${readColor}">${readiness}%</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${readiness}%;background:${readColor}"></div></div>
    <p style="font-size:11px;color:#64748b;margin-top:5px">
      ${readiness>=80?"Ready to apply — tailor your CV and start reaching out.":readiness>=60?"Close to ready — address key gaps first.":"Focus on the roadmap before applying broadly."}
    </p>
  </div>

  <div class="grid2">
    <div class="card">
      <h3>⭐ Strengths</h3>
      ${strengths.map(s=>`<div class="sk">
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:12px;font-weight:600">${esc(s.skill)}</span>
          <span style="font-size:12px;font-weight:700;color:#0d9488">${Number(s.level||0)}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${Number(s.level||0)}%;background:#0d9488"></div></div>
        ${s.note?`<p style="font-size:10px;color:#64748b">${esc(s.note)}</p>`:""}
      </div>`).join("")||"<p style='color:#64748b;font-size:12px'>No strengths found.</p>"}
    </div>
    <div class="card">
      <h3>⚠️ Skill Gaps</h3>
      ${gaps.map(g=>`<div class="gap-item">
        <div>
          <p style="font-size:12px;font-weight:600">${esc(g.skill)}</p>
          ${g.note?`<p style="font-size:10px;color:#64748b">${esc(g.note)}</p>`:""}
        </div>
        ${g.importance?`<span class="badge ${g.importance==='critical'?'br':g.importance==='important'?'ba':'bt'}">${esc(g.importance)}</span>`:""}
      </div>`).join("")||"<p style='color:#64748b;font-size:12px'>No major gaps.</p>"}
    </div>
  </div>

  ${nextSteps.length?`<h2>🚀 This Week's Actions</h2>
  ${nextSteps.slice(0,3).map((s,i)=>`<div class="step-row"><div class="num">${i+1}</div><p style="font-size:12px">${esc(s)}</p></div>`).join("")}`:""}

  ${careerAdv.length?`<h2>💡 Career Advice</h2>
  ${careerAdv.map(a=>`<div class="adv"><span style="color:#0d9488;font-weight:700;margin-right:6px">→</span><p style="font-size:12px">${esc(a)}</p></div>`).join("")}`:""}

  ${salary.range?`<h2>💰 Salary Insights — India Market</h2>
  <div class="sal">${esc(salary.range)}</div>
  <div class="sp">
    <div class="sh"><p style="font-size:10px;color:#64748b;text-transform:uppercase;margin-bottom:5px">Entry Level</p><p style="font-size:18px;font-weight:800;color:#2563eb">${esc(salary.entry||"—")}</p></div>
    <div class="sh"><p style="font-size:10px;color:#64748b;text-transform:uppercase;margin-bottom:5px">Senior Level</p><p style="font-size:18px;font-weight:800;color:#059669">${esc(salary.senior||"—")}</p></div>
  </div>
  ${salary.note?`<p style="font-size:11px;color:#64748b;padding:9px;background:#f8fafc;border-radius:7px">${esc(salary.note)}</p>`:""}`:""}

  ${courses.length?`<h2>📚 Recommended Courses</h2>
  ${courses.map(c=>{const isFree=c.free===true||String(c.free).toLowerCase()==="true";return`<div class="cr">
    <div style="flex:1">
      <p style="font-weight:600;font-size:12px">${esc(c.name||c.title||"Course")}</p>
      <p style="font-size:11px;color:#0d9488">${esc(c.platform||"")}</p>
      ${c.note?`<p style="font-size:10px;color:#64748b">${esc(c.note)}</p>`:""}
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
      <span class="badge ${isFree?'bg':'bb'}">${isFree?"Free":"Paid"}</span>
      ${c.url?`<a href="${esc(c.url)}">Open →</a>`:""}
    </div>
  </div>`;}).join("")}`:""}

  ${cvAdvice.length?`<h2>📝 CV Improvement Tips</h2>
  ${cvAdvice.map((tip,i)=>`<div class="tip"><div class="num">${i+1}</div><p style="font-size:12px">${esc(tip)}</p></div>`).join("")}`:""}

  ${roadmap.length?`<h2>🗺️ Learning Roadmap</h2>
  ${roadmap.map((s,i)=>`<div class="tl">
    <div class="tld">${i+1}</div>
    <div style="flex:1">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
        <p style="font-weight:700;font-size:13px">${esc(s.title||"Step")}</p>
        ${s.duration?`<span class="badge bt">${esc(s.duration)}</span>`:""}
      </div>
      ${s.why?`<p style="font-size:11px;color:#64748b;margin-bottom:5px">${esc(s.why)}</p>`:""}
      ${Array.isArray(s.resources)&&s.resources.length?`<div style="padding-left:6px">
        ${s.resources.map(r=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:11px;flex:1">${esc(r.name||"")}</span>
          <span class="badge ${r.free?'bg':'bb'}" style="font-size:9px">${r.free?"Free":"Paid"}</span>
          ${r.url?`<a href="${esc(r.url)}">→</a>`:""}
        </div>`).join("")}
      </div>`:""}
    </div>
  </div>`).join("")}`:""}

  ${altRoles.length?`<h2>🔄 Alternative Roles</h2>
  <div class="grid2">
    ${altRoles.map(r=>{const m=Number(r.match||0);const col=m>=75?"#059669":m>=50?"#2563eb":"#d97706";return`<div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <p style="font-weight:700;font-size:13px">${esc(r.title)}</p>
        <span style="font-weight:800;color:${col}">${m}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${m}%;background:${col}"></div></div>
      ${r.reason?`<p style="font-size:11px;color:#64748b;margin-top:5px">${esc(r.reason)}</p>`:""}
    </div>`;}).join("")}
  </div>`:""}

  <div class="footer">Generated by SkillBridge AI · GPT-OSS 120B · India salary data · For reference only</div>
  </body></html>`;

  // ── Open in new tab → browser native print → Save as PDF ──
  const btn = byId("export-btn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span class="hidden md:inline ml-1">Opening...</span>';
  }

  const printWin = window.open("", "_blank");
  if (!printWin) {
    alert("Please allow pop-ups for this site, then click Download again.");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-download"></i><span class="hidden md:inline ml-1">Download</span>';
    }
    return;
  }

  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();

  // Wait for fonts/layout to settle, then trigger print dialog
  setTimeout(() => {
    printWin.print();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-download"></i><span class="hidden md:inline ml-1">Download</span>';
    }
  }, 900);
}

// ═══════════════════════════════════════════════════
// JOB URL FETCH
// ═══════════════════════════════════════════════════
async function fetchJobUrl() {
  const url = byId("job-url").value.trim();
  if (!url) return showErr("Enter a job URL first.");
  const btn = byId("fetch-job-btn");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching...';
  hideErr();
  try {
    const res  = await fetch("/api/fetch-job-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    byId("jd").value = data.description || "";
    if (data.title && !byId("jt").value.trim()) byId("jt").value = data.title;
  } catch (e) {
    showErr(e.message || "Could not fetch. Paste description manually.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-cloud-arrow-down"></i> Fetch';
  }
}

// ═══════════════════════════════════════════════════
// MAIN ANALYSIS
// ═══════════════════════════════════════════════════
async function runAnalysis() {
  const jobDescription = byId("jd").value.trim();
  const jobTitle       = byId("jt").value.trim();
  const cvText         = byId("cv-txt").value.trim();
  const cvFile         = byId("cf").files[0];

  if (!jobDescription && !jobTitle) return showErr("Please enter a job title or job description.");

  hideErr();
  showPg("loading");
  startLoading();
  byId("ab").disabled = true;

  try {
    const fd = new FormData();
    fd.append("job_description", jobDescription);
    fd.append("job_title", jobTitle);
    if (cvFile) fd.append("cv_file", cvFile);
    if (cvText) fd.append("cv_text", cvText);

    const res  = await fetch("/api/analyse", { method: "POST", body: fd });
    const data = await readJsonSafe(res);
    if (!res.ok || data.error) throw new Error(data.error || "Analyse failed");

    latestAnalysisData = data;
    renderResults(data);
    byId("nt-results").style.display = "inline-flex";
    byId("export-btn").classList.remove("hidden");
    showPg("results");
    if (Number(data.overall_match) >= 75) setTimeout(fireConfetti, 400);
  } catch (e) {
    showPg("home");
    showErr("Error: " + e.message);
  } finally {
    stopLoading();
    byId("ab").disabled = false;
  }
}

// ═══════════════════════════════════════════════════
// RENDER RESULTS
// ═══════════════════════════════════════════════════
function renderResults(data) {
  const match      = Number(data.overall_match || 0);
  const readiness  = Number(data.apply_readiness || match);
  const strengths  = Array.isArray(data.strengths)           ? data.strengths           : [];
  const gaps       = Array.isArray(data.gaps)                ? data.gaps                : [];
  const courses    = Array.isArray(data.recommended_courses) ? data.recommended_courses : [];
  const roadmap    = Array.isArray(data.roadmap)             ? data.roadmap             : [];
  const altRoles   = Array.isArray(data.alternative_roles)   ? data.alternative_roles   : [];
  const salary     = data.salary_insight || {};
  const nextSteps  = Array.isArray(data.next_steps)          ? data.next_steps          : [];
  const careerAdv  = Array.isArray(data.career_advice)       ? data.career_advice       : [];

  const ringColor  = match >= 75 ? "var(--green)" : match >= 50 ? "var(--blue)" : "var(--red)";
  const matchLabel = match >= 75 ? "Strong Match"  : match >= 50 ? "Good Foundation" : "Needs Work";
  const matchBdg   = match >= 75 ? "bdg-green"     : match >= 50 ? "bdg-blue" : "bdg-red";

  // ── OVERVIEW ──
  byId("rc").innerHTML = `
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
      <div>
        <div class="flex items-center gap-3 mb-2 flex-wrap">
          <h2 class="font-bold tracking-tight" style="font-size:2rem;letter-spacing:-1px">${safe(data.job_title || "Career Gap Analysis")}</h2>
          <span class="bdg ${matchBdg}">${matchLabel}</span>
        </div>
        <p class="text-sm leading-relaxed" style="color:var(--text-muted);max-width:560px">${safe(data.summary || "")}</p>
      </div>
      <button class="btn btn-ghost flex-shrink-0" onclick="goHome()"><i class="fas fa-redo mr-2"></i>New</button>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      <div class="glass p-5 flex items-center gap-4 col-span-2 sm:col-span-1">
        <div class="relative w-16 h-16 flex-shrink-0">
          <svg class="ring-svg w-16 h-16"><circle cx="32" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="4"></circle><circle id="mr" class="ring-circle" cx="32" cy="32" r="20" fill="none" stroke="${ringColor}" stroke-width="4" stroke-linecap="round"></circle></svg>
          <div class="absolute inset-0 flex items-center justify-center"><span class="font-bold text-sm">${match}%</span></div>
        </div>
        <div><p class="font-bold text-2xl">${match}%</p><p class="text-xs" style="color:var(--text-muted)">Job Match</p></div>
      </div>
      <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--green)">${strengths.length}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Strengths</p></div>
      <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--red)">${gaps.length}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Skill Gaps</p></div>
      <div class="glass p-5"><p class="font-bold text-3xl" style="color:var(--blue)">${courses.length}</p><p class="text-xs mt-1" style="color:var(--text-muted)">Courses Found</p></div>
    </div>
    <div class="glass p-5 mb-5">
      <div class="flex items-center justify-between mb-3"><span class="font-semibold text-sm">Apply Readiness</span><span class="font-bold" style="color:var(--teal)">${readiness}%</span></div>
      <div class="bar-track"><div class="bar-fill" data-w="${readiness}%" style="background:linear-gradient(90deg,var(--teal),var(--green))"></div></div>
      <p class="text-xs mt-2" style="color:var(--text-muted)">${readiness>=80?"You're ready to apply now.":readiness>=60?"Close to ready — address key gaps.":"Focus on the roadmap first."}</p>
    </div>
    <div class="grid lg:grid-cols-2 gap-4 mb-5">
      <div class="glass p-6">
        <h3 class="font-bold mb-4 flex items-center gap-2"><i class="fas fa-star" style="color:var(--amber)"></i>Your Strengths</h3>
        <div class="space-y-4">
          ${strengths.map(s=>`<div><div class="flex items-center justify-between mb-2"><span class="text-sm font-semibold">${safe(s.skill)}</span><span class="text-sm font-bold" style="color:var(--teal)">${Number(s.level||0)}%</span></div><div class="bar-track"><div class="bar-fill" data-w="${Number(s.level||0)}%"></div></div>${s.note?`<p class="text-xs mt-1" style="color:var(--text-muted)">${safe(s.note)}</p>`:""}</div>`).join("") || '<p class="text-sm" style="color:var(--text-muted)">No strengths found.</p>'}
        </div>
      </div>
      <div class="glass p-6">
        <h3 class="font-bold mb-4 flex items-center gap-2"><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i>Skill Gaps</h3>
        <div class="space-y-3">
          ${gaps.map(g=>{const b=g.importance==="critical"?"bdg-red":g.importance==="important"?"bdg-amber":"bdg-teal";return`<div class="p-4 rounded-xl" style="background:rgba(255,255,255,.03);border:1px solid var(--border)"><div class="flex items-center justify-between gap-2 mb-1"><p class="text-sm font-semibold">${safe(g.skill)}</p>${g.importance?`<span class="bdg ${b}">${safe(g.importance)}</span>`:""}</div>${g.note?`<p class="text-xs" style="color:var(--text-muted)">${safe(g.note)}</p>`:""}</div>`;}).join("") || '<p class="text-sm" style="color:var(--green)">No major gaps detected.</p>'}
        </div>
      </div>
    </div>
    ${nextSteps.length?`<div class="glass p-6 mb-5"><h3 class="font-bold mb-4 flex items-center gap-2"><i class="fas fa-rocket" style="color:var(--teal)"></i>This Week's Actions</h3><div class="grid sm:grid-cols-3 gap-3">${nextSteps.slice(0,3).map((s,i)=>`<div class="p-4 rounded-xl flex items-start gap-3" style="background:rgba(255,255,255,.03);border:1px solid var(--border)"><span class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style="background:linear-gradient(135deg,var(--teal),var(--blue));color:#fff">${i+1}</span><p class="text-sm">${safe(s)}</p></div>`).join("")}</div></div>`:""}
    ${careerAdv.length?`<div class="glass p-6"><h3 class="font-bold mb-4 flex items-center gap-2"><i class="fas fa-lightbulb" style="color:var(--amber)"></i>Career Advice</h3><div class="space-y-2">${careerAdv.map(a=>`<div class="flex items-start gap-3 p-3 rounded-xl" style="background:rgba(255,255,255,.02)"><i class="fas fa-arrow-right mt-1 flex-shrink-0" style="color:var(--teal);font-size:11px"></i><p class="text-sm">${safe(a)}</p></div>`).join("")}</div></div>`:""}`;

  // ── COURSES ──
  byId("courses-container").innerHTML = courses.length ? `
    <h2 class="font-bold text-2xl mb-2">Recommended Courses</h2>
    <p class="text-sm mb-6" style="color:var(--text-muted)">Curated based on your skill gaps. Click any card to open.</p>
    <div class="space-y-3">
      ${courses.map(c => {
        const pl = getPlatformInfo(c.platform || c.name || "", c.url || "");
        const isFree = c.free === true || String(c.free).toLowerCase() === "true";
        return `<a href="${safe(c.url||"#")}" target="_blank" rel="noopener noreferrer" class="course-card block">
          <div style="width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${pl.color}22"><i class="fas ${pl.icon}" style="color:${pl.color};font-size:16px"></i></div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2">
              <p class="font-semibold text-sm">${safe(c.name||c.title||"Course")}</p>
              <div class="flex items-center gap-2 flex-shrink-0">${isFree?'<span class="bdg bdg-green">Free</span>':'<span class="bdg bdg-blue">Paid</span>'}<i class="fas fa-external-link-alt" style="color:var(--text-muted);font-size:10px"></i></div>
            </div>
            <p class="text-xs mt-1" style="color:var(--teal)">${safe(c.platform||pl.label)}</p>
            ${c.skill?`<span class="bdg bdg-purple mt-2" style="font-size:9px">${safe(c.skill)}</span>`:""}
            ${c.note?`<p class="text-xs mt-2" style="color:var(--text-muted)">${safe(c.note)}</p>`:""}
          </div>
        </a>`;
      }).join("")}
    </div>` : `<div class="glass p-10 text-center"><i class="fas fa-graduation-cap text-4xl mb-4" style="color:var(--text-muted)"></i><p class="font-semibold mb-2">No courses returned</p></div>`;

  // ── ROADMAP ──
  byId("roadmap-container").innerHTML = `
    <h2 class="font-bold text-2xl mb-2">Learning Roadmap</h2>
    <p class="text-sm mb-6" style="color:var(--text-muted)">Your personalised step-by-step plan.</p>
    <div class="space-y-4">
      ${roadmap.map((s, i) => `
        <div class="timeline-item">
          <div class="timeline-dot">${i+1}</div>
          <div class="glass p-5">
            <div class="flex items-start justify-between gap-3 mb-2">
              <p class="font-bold">${safe(s.title||"Step")}</p>
              ${s.duration?`<span class="bdg bdg-teal flex-shrink-0">${safe(s.duration)}</span>`:""}
            </div>
            ${s.why?`<p class="text-sm mb-3" style="color:var(--text-muted)">${safe(s.why)}</p>`:""}
            ${Array.isArray(s.resources)&&s.resources.length?`<div class="space-y-2 mt-3">${s.resources.map(r=>{const pl=getPlatformInfo(r.name||"",r.url||"");return`<a href="${safe(r.url||"#")}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3 rounded-xl transition-all" style="background:rgba(255,255,255,.03);border:1px solid var(--border);text-decoration:none" onmouseover="this.style.borderColor='var(--border-teal)'" onmouseout="this.style.borderColor='var(--border)'"><i class="fas ${pl.icon} flex-shrink-0" style="color:${pl.color};font-size:14px;width:16px;text-align:center"></i><span class="text-sm font-medium flex-1">${safe(r.name||"Resource")}</span>${r.free?'<span class="bdg bdg-green" style="font-size:9px">Free</span>':'<span class="bdg bdg-blue" style="font-size:9px">Paid</span>'}<i class="fas fa-external-link-alt" style="color:var(--text-muted);font-size:10px"></i></a>`;}).join("")}</div>`:""}
          </div>
        </div>`).join("") || '<p style="color:var(--text-muted)">No roadmap returned.</p>'}
    </div>`;

  // ── SALARY ──
  byId("salary-container").innerHTML = `
    <h2 class="font-bold text-2xl mb-2">Salary Insights</h2>
    <p class="text-sm mb-6" style="color:var(--text-muted)">Estimated compensation in ₹ for ${safe(data.job_title||"this role")} — India market rates.</p>
    ${salary.range ? `
      <div class="glass p-8 mb-5 text-center">
        <p class="text-xs uppercase tracking-widest mb-3" style="color:var(--text-muted)">Typical Range</p>
        <p class="font-extrabold grad-text" style="font-size:2.5rem;letter-spacing:-1px">${safe(salary.range)}</p>
        ${salary.note?`<p class="text-sm mt-3" style="color:var(--text-muted)">${safe(salary.note)}</p>`:""}
      </div>
      <div class="grid sm:grid-cols-2 gap-4 mb-5">
        <div class="glass p-6 text-center"><p class="text-xs uppercase tracking-widest mb-2" style="color:var(--text-muted)">Entry Level</p><p class="font-bold text-2xl" style="color:var(--blue)">${safe(salary.entry||"—")}</p></div>
        <div class="glass p-6 text-center"><p class="text-xs uppercase tracking-widest mb-2" style="color:var(--text-muted)">Senior Level</p><p class="font-bold text-2xl" style="color:var(--green)">${safe(salary.senior||"—")}</p></div>
      </div>` : `<div class="glass p-8 text-center"><p style="color:var(--text-muted)">Salary data not available.</p></div>`}
    <div class="glass p-5" style="border:1px solid rgba(245,158,11,.2);background:var(--amber-dim)">
      <p class="text-xs" style="color:var(--amber)"><i class="fas fa-circle-info mr-2"></i>Figures are AI estimates. Verify on AmbitionBox, Glassdoor India, or LinkedIn Salary.</p>
    </div>`;

  // ── CV TIPS ──
  byId("cvtips-container").innerHTML = `
    <h2 class="font-bold text-2xl mb-2">CV Improvement Tips</h2>
    <p class="text-sm mb-6" style="color:var(--text-muted)">Actionable advice to make your CV stand out.</p>
    <div class="space-y-3">
      ${(data.cv_advice||[]).map((tip,i)=>`
        <div class="glass p-5 flex items-start gap-4">
          <div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm" style="background:linear-gradient(135deg,var(--teal),var(--blue));color:#fff">${i+1}</div>
          <p class="text-sm leading-relaxed mt-1">${safe(tip)}</p>
        </div>`).join("") || '<p style="color:var(--text-muted)">No tips returned.</p>'}
    </div>`;

  // ── ALT ROLES ──
  byId("alt-container").innerHTML = `
    <h2 class="font-bold text-2xl mb-2">Alternative Roles</h2>
    <p class="text-sm mb-6" style="color:var(--text-muted)">Other roles where your skills may be a stronger fit.</p>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${altRoles.map(r => {
        const m = Number(r.match||0);
        const col = m>=75?"var(--green)":m>=50?"var(--blue)":"var(--amber)";
        return `<div class="glass p-5">
          <div class="flex items-start justify-between gap-2 mb-3"><p class="font-bold">${safe(r.title)}</p><span class="font-extrabold text-lg" style="color:${col}">${m}%</span></div>
          <div class="bar-track mb-3"><div class="bar-fill" data-w="${m}%" style="background:${col}"></div></div>
          ${r.reason?`<p class="text-xs" style="color:var(--text-muted)">${safe(r.reason)}</p>`:""}
        </div>`;
      }).join("") || '<p style="color:var(--text-muted)">No alternative roles suggested.</p>'}
    </div>`;

  // Animate bars + ring
  setTimeout(() => {
    document.querySelectorAll(".bar-fill[data-w]").forEach(b => b.style.width = b.getAttribute("data-w"));
    const ring = byId("mr");
    if (ring) ring.style.strokeDashoffset = String(251 - (251 * match / 100));
  }, 250);

  resetAssessmentUI();
  resetInterview();
}

// ═══════════════════════════════════════════════════
// ASSESSMENT
// ═══════════════════════════════════════════════════
function setAssessmentDifficulty(level) {
  assessmentDifficulty = level;
  ["beginner","intermediate","advanced"].forEach(l => {
    const el = byId("assessment-diff-" + l);
    if (el) el.classList.toggle("on", l === level);
  });
}

function resetAssessmentUI() {
  assessmentQuestions = []; assessmentAnswers = []; assessmentSubmitted = false;
  byId("assessment-start-wrap").classList.remove("hidden");
  byId("assessment-loading").classList.add("hidden");
  byId("assessment-error").classList.add("hidden");
  byId("assessment-error").textContent = "";
  byId("assessment-questions").innerHTML = "";
  byId("assessment-submit-btn").classList.add("hidden");
  byId("assessment-score").classList.add("hidden");
  if (byId("goto-answers-btn")) byId("goto-answers-btn").classList.add("hidden");
  if (byId("assessment-start-btn")) byId("assessment-start-btn").disabled = false;
  if (byId("answers-tab-btn")) byId("answers-tab-btn").style.display = "none";
}

function setAssessmentError(msg) {
  const el = byId("assessment-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function renderAssessmentQuestions(questions) {
  byId("assessment-questions").innerHTML = questions.map((q, i) => `
    <div class="p-4 rounded-xl assessment-question" style="background:rgba(255,255,255,.03);border:1px solid var(--border)" data-index="${i}">
      <p class="font-semibold mb-3 text-sm">${i+1}. ${safe(q.question||q.text||"")}</p>
      ${q.skill?`<span class="bdg bdg-purple mb-3 inline-block" style="font-size:9px">${safe(q.skill)}</span>`:""}
      <div class="space-y-2 mt-2">
        ${(Array.isArray(q.options)?q.options:[]).map(opt=>`
          <label class="assessment-option cursor-pointer">
            <input type="radio" name="assessment-q-${i}" value="${safe(opt)}" />
            <span class="text-sm">${safe(opt)}</span>
          </label>`).join("")}
      </div>
    </div>`).join("");
  byId("assessment-submit-btn").classList.remove("hidden");
}

async function startAssessment() {
  byId("assessment-error").classList.add("hidden");
  byId("assessment-score").classList.add("hidden");
  byId("assessment-questions").innerHTML = "";
  byId("assessment-submit-btn").classList.add("hidden");
  byId("assessment-loading").classList.remove("hidden");
  byId("assessment-start-btn").disabled = true;
  try {
    const role = (latestAnalysisData && latestAnalysisData.job_title) || byId("jt").value.trim() || "Data Analyst";
    const payload = { role, difficulty: assessmentDifficulty, analysis: latestAnalysisData || {} };
    if (latestAnalysisData) {
      payload.role_category = latestAnalysisData.role_category || "Tech";
      payload.selected_role = latestAnalysisData.selected_role || role;
    }
    const res  = await fetch("/api/assessment/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await readJsonSafe(res);
    if (!res.ok || data.error) throw new Error(data.error || "Could not start assessment.");
    assessmentQuestions = Array.isArray(data.questions) ? data.questions : [];
    if (!assessmentQuestions.length) throw new Error("No questions returned.");
    byId("assessment-loading").classList.add("hidden");
    byId("assessment-start-wrap").classList.add("hidden");
    renderAssessmentQuestions(assessmentQuestions);
  } catch (e) {
    byId("assessment-loading").classList.add("hidden");
    byId("assessment-start-btn").disabled = false;
    setAssessmentError(e.message || "Failed to start assessment.");
  }
}

async function submitAssessment() {
  if (!assessmentQuestions.length) return setAssessmentError("Start assessment first.");
  byId("assessment-error").classList.add("hidden");
  const answers = assessmentQuestions.map((q, i) => {
    const selected = document.querySelector(`input[name="assessment-q-${i}"]:checked`);
    return {
      selected:    selected ? selected.value : "",
      correct:     q.correct || "",
      skill:       q.skill || "",
      question:    q.question || q.text || "",
      explanation: q.explanation || "",
      options:     q.options || []
    };
  });
  if (answers.some(a => !a.selected)) return setAssessmentError("Please answer all questions before submitting.");
  byId("assessment-submit-btn").disabled = true;
  try {
    const res    = await fetch("/api/assessment/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
    const result = await readJsonSafe(res);
    if (!res.ok || result.error) throw new Error(result.error || "Could not evaluate.");
    const score = Number(result.score || 0);
    assessmentAnswers  = answers;
    assessmentSubmitted = true;

    byId("assessment-score-value").textContent = score + "%";
    byId("assessment-score").classList.remove("hidden");
    if      (score >= 80) { byId("assessment-score").style.background = "var(--green-dim)"; byId("assessment-score").style.color = "var(--green)"; }
    else if (score >= 60) { byId("assessment-score").style.background = "var(--blue-dim)";  byId("assessment-score").style.color = "var(--blue)"; }
    else                  { byId("assessment-score").style.background = "var(--red-dim)";   byId("assessment-score").style.color = "var(--red)"; }

    if (result.feedback) { byId("assessment-feedback").textContent = result.feedback; byId("assessment-feedback").classList.remove("hidden"); }
    byId("goto-answers-btn").classList.remove("hidden");
    renderAnswersTab(answers, score);
    if (byId("answers-tab-btn")) byId("answers-tab-btn").style.display = "inline-flex";
    document.querySelectorAll('#assessment-questions input[type="radio"]').forEach(r => r.disabled = true);
    if (score >= 80) fireConfetti();
  } catch (e) {
    setAssessmentError(e.message || "Failed to submit.");
  } finally {
    byId("assessment-submit-btn").disabled = false;
  }
}

// ═══════════════════════════════════════════════════
// ANSWERS TAB RENDER
// ═══════════════════════════════════════════════════
function renderAnswersTab(answers, score) {
  const container = byId("answers-container");
  if (!container) return;
  if (byId("answers-score-display")) byId("answers-score-display").textContent = score + "%";

  const correctCount = answers.filter(a => a.selected && a.selected === a.correct).length;
  const total        = answers.length;

  container.innerHTML = `
    <div class="glass p-5 mb-5">
      <div class="grid grid-cols-3 gap-4 text-center mb-4">
        <div><p class="text-2xl font-extrabold" style="color:var(--green)">${correctCount}</p><p class="text-xs" style="color:var(--text-muted)">Correct</p></div>
        <div><p class="text-2xl font-extrabold" style="color:var(--red)">${total-correctCount-answers.filter(a=>!a.selected).length}</p><p class="text-xs" style="color:var(--text-muted)">Incorrect</p></div>
        <div><p class="text-2xl font-extrabold" style="color:var(--amber)">${answers.filter(a=>!a.selected).length}</p><p class="text-xs" style="color:var(--text-muted)">Skipped</p></div>
      </div>
      <div class="bar-track"><div class="bar-fill" data-w="${score}%" style="background:${score>=80?'var(--green)':score>=60?'var(--blue)':'var(--red)'}"></div></div>
    </div>
    ${answers.map((a, i) => {
      const isCorrect = a.selected && a.selected === a.correct;
      const isSkipped = !a.selected;
      const cardClass = isSkipped ? "skipped" : isCorrect ? "correct" : "incorrect";
      const statusColor = isSkipped ? "var(--amber)" : isCorrect ? "var(--green)" : "var(--red)";
      const statusLabel = isSkipped ? "Skipped" : isCorrect ? "Correct" : "Incorrect";
      return `
      <div class="review-card ${cardClass}">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-start gap-3 flex-1">
            <span class="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style="background:linear-gradient(135deg,var(--teal),var(--blue));color:#fff">${i+1}</span>
            <div class="flex-1">
              <p class="font-semibold text-sm leading-relaxed">${safe(a.question)}</p>
              ${a.skill?`<span class="bdg bdg-purple mt-1 inline-block" style="font-size:9px">${safe(a.skill)}</span>`:""}
            </div>
          </div>
          <span class="bdg flex-shrink-0" style="background:${statusColor}22;color:${statusColor}">
            <i class="fas ${isCorrect?'fa-check-circle':isSkipped?'fa-minus-circle':'fa-times-circle'} mr-1"></i>${statusLabel}
          </span>
        </div>
        <div class="space-y-2 mb-3">
          ${(a.options||[]).map(opt => {
            const isUserChoice   = opt === a.selected;
            const isRightAnswer  = opt === a.correct;
            let bg = "rgba(255,255,255,.03)", border = "var(--border)";
            if (isRightAnswer)              { bg = "rgba(16,185,129,.08)"; border = "rgba(16,185,129,.4)"; }
            if (isUserChoice && !isRightAnswer) { bg = "rgba(239,68,68,.08)"; border = "rgba(239,68,68,.4)"; }
            return `<div class="flex items-center gap-3 p-3 rounded-xl text-sm" style="background:${bg};border:1px solid ${border}">
              ${isRightAnswer?'<i class="fas fa-check-circle flex-shrink-0" style="color:var(--green);font-size:13px"></i>':isUserChoice?'<i class="fas fa-times-circle flex-shrink-0" style="color:var(--red);font-size:13px"></i>':'<span class="w-4 h-4 flex-shrink-0 rounded-full" style="border:1.5px solid var(--border)"></span>'}
              <span class="flex-1">${safe(opt)}</span>
              ${isUserChoice&&!isRightAnswer?'<span class="text-xs font-bold" style="color:var(--red)">Your answer</span>':""}
              ${isRightAnswer?'<span class="text-xs font-bold" style="color:var(--green)">Correct</span>':""}
            </div>`;
          }).join("")}
        </div>
        ${a.explanation?`
        <div class="p-3 rounded-xl" style="background:rgba(45,212,191,.06);border:1px solid var(--border-teal)">
          <p class="text-xs font-semibold mb-1" style="color:var(--teal)"><i class="fas fa-lightbulb mr-1"></i>Explanation</p>
          <p class="text-xs leading-relaxed" style="color:var(--text)">${safe(a.explanation)}</p>
        </div>`:""}
      </div>`;
    }).join("")}
    <div class="text-center mt-6">
      <button class="btn btn-primary" onclick="jumpToAssessment();resetAssessmentUI()">
        <i class="fas fa-redo mr-2"></i>Retake Assessment
      </button>
    </div>`;

  setTimeout(() => {
    const bar = container.querySelector(".bar-fill[data-w]");
    if (bar) bar.style.width = bar.getAttribute("data-w");
  }, 200);
}

// ═══════════════════════════════════════════════════
// AI INTERVIEW — CORE
// ═══════════════════════════════════════════════════
function resetInterview() {
  interviewHistory = []; interviewQIndex = 0; interviewFinished = false; interviewVoiceMode = false;
  stopSpeaking(); stopVoiceInput();
  if (byId("interview-intro-card"))     byId("interview-intro-card").classList.remove("hidden");
  if (byId("interview-start-wrap"))     byId("interview-start-wrap").classList.remove("hidden");
  if (byId("interview-chat-wrap"))      byId("interview-chat-wrap").classList.add("hidden");
  if (byId("interview-feedback-card"))  byId("interview-feedback-card").classList.add("hidden");
  if (byId("interview-progress-wrap"))  byId("interview-progress-wrap").classList.add("hidden");
  if (byId("interview-chat"))           byId("interview-chat").innerHTML = "";
  if (byId("interview-input-wrap"))     byId("interview-input-wrap").classList.add("hidden");
  if (byId("interview-end-wrap"))       byId("interview-end-wrap").classList.add("hidden");
  if (byId("interview-feedback-text"))  byId("interview-feedback-text").classList.add("hidden");
  if (byId("interview-feedback-loading")) byId("interview-feedback-loading").classList.remove("hidden");
  if (byId("restart-after-feedback"))   byId("restart-after-feedback").classList.add("hidden");
  checkVoiceSupport();
}

function checkVoiceSupport() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!SpeechRecognition;
  const note = byId("voice-support-note");
  const startVoiceBtn = byId("start-voice-btn");
  if (note) note.classList.toggle("hidden", supported);
  if (startVoiceBtn) startVoiceBtn.disabled = !supported;
  if (!supported && startVoiceBtn) { startVoiceBtn.style.opacity = "0.4"; startVoiceBtn.title = "Voice not supported in this browser"; }
  return supported;
}

async function startInterview(withVoice = false) {
  interviewVoiceMode = withVoice;
  interviewHistory = []; interviewQIndex = 0; interviewFinished = false;
  if (byId("interview-intro-card"))    byId("interview-intro-card").classList.add("hidden");
  if (byId("interview-chat-wrap"))     byId("interview-chat-wrap").classList.remove("hidden");
  if (byId("interview-progress-wrap")) byId("interview-progress-wrap").classList.remove("hidden");
  updateInterviewProgress();
  const role = (latestAnalysisData && latestAnalysisData.job_title) || byId("jt").value.trim() || "Software Engineer";
  try {
    const res  = await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, history: [], question_index: 0, analysis: latestAnalysisData || {} }) });
    const data = await readJsonSafe(res);
    if (!res.ok || data.error) throw new Error(data.error || "Failed to start interview");
    const aiText = data.response || "Tell me about yourself.";
    interviewHistory.push({ role: "assistant", content: aiText });
    appendChatBubble("ai", aiText);
    if (withVoice) speakText(aiText);
    byId("interview-input-wrap").classList.remove("hidden");
    byId("interview-input-wrap").querySelector("textarea").focus();
    setupInterviewKeyboard();
  } catch (e) {
    appendChatBubble("ai", "⚠️ Could not start interview: " + e.message);
  }
}

function setupInterviewKeyboard() {
  const ta = byId("interview-user-input");
  if (!ta || ta._sbkeybound) return;
  ta._sbkeybound = true;
  ta.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendInterviewMsg(); }
  });
}

async function sendInterviewMsg() {
  const ta   = byId("interview-user-input");
  const text = (ta.value || "").trim();
  if (!text || interviewFinished) return;
  ta.value = "";
  stopVoiceInput();
  interviewHistory.push({ role: "user", content: text });
  appendChatBubble("user", text);
  interviewQIndex++;
  updateInterviewProgress();
  const typingId = "typing-" + Date.now();
  appendTypingIndicator(typingId);
  try {
    const role = (latestAnalysisData && latestAnalysisData.job_title) || "Software Engineer";
    const res  = await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, history: interviewHistory, question_index: interviewQIndex, analysis: latestAnalysisData || {} }) });
    const data = await readJsonSafe(res);
    removeTypingIndicator(typingId);
    if (!res.ok || data.error) throw new Error(data.error || "Interview error");
    const aiText = data.response || "Thank you. Next question...";
    interviewHistory.push({ role: "assistant", content: aiText });
    appendChatBubble("ai", aiText);
    if (interviewVoiceMode) speakText(aiText);
    if (data.finished || interviewQIndex >= 8) {
      interviewFinished = true;
      byId("interview-input-wrap").classList.add("hidden");
      byId("interview-end-wrap").classList.remove("hidden");
      appendChatBubble("ai", "That wraps up our interview! Click <strong>Get AI Feedback</strong> below to receive your detailed performance review.");
    }
  } catch (e) {
    removeTypingIndicator(typingId);
    appendChatBubble("ai", "⚠️ " + e.message);
  }
}

// ── INTERVIEW UI HELPERS ──
function appendChatBubble(role, html) {
  const chat = byId("interview-chat"); if (!chat) return;
  const wrap   = document.createElement("div");
  wrap.className = role === "ai" ? "flex gap-3 mb-4" : "flex gap-3 mb-4 flex-row-reverse";
  const avatar = role === "ai"
    ? `<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style="background:linear-gradient(135deg,var(--teal),var(--blue))"><i class="fas fa-robot text-white" style="font-size:12px"></i></div>`
    : `<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style="background:linear-gradient(135deg,#3b82f6,#8b5cf6)"><i class="fas fa-user text-white" style="font-size:12px"></i></div>`;
  const bubble = document.createElement("div");
  bubble.className = role === "ai" ? "chat-bubble-ai" : "chat-bubble-user";
  bubble.innerHTML = html;
  wrap.innerHTML = avatar;
  role === "ai" ? wrap.appendChild(bubble) : wrap.insertBefore(bubble, wrap.firstChild);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function appendTypingIndicator(id) {
  const chat = byId("interview-chat"); if (!chat) return;
  const wrap = document.createElement("div");
  wrap.id = id; wrap.className = "flex gap-3 mb-4";
  wrap.innerHTML = `<div class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style="background:linear-gradient(135deg,var(--teal),var(--blue))"><i class="fas fa-robot text-white" style="font-size:12px"></i></div><div class="chat-bubble-ai"><div class="interview-typing"><span></span><span></span><span></span></div></div>`;
  chat.appendChild(wrap); chat.scrollTop = chat.scrollHeight;
}

function removeTypingIndicator(id) { const el = byId(id); if (el) el.remove(); }

function updateInterviewProgress() {
  const n   = Math.min(interviewQIndex, 8);
  const pct = Math.round((n / 8) * 100);
  if (byId("interview-q-count"))    byId("interview-q-count").textContent = `Q${n+1} of 8`;
  if (byId("interview-progress-bar")) byId("interview-progress-bar").style.width = pct + "%";
}

// ── INTERVIEW FEEDBACK ──
async function getInterviewFeedback() {
  const card = byId("interview-feedback-card");
  if (card) card.classList.remove("hidden");
  byId("interview-feedback-loading").classList.remove("hidden");
  byId("interview-feedback-text").classList.add("hidden");
  if (byId("restart-after-feedback")) byId("restart-after-feedback").classList.add("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const role = (latestAnalysisData && latestAnalysisData.job_title) || "Software Engineer";
    const res  = await fetch("/api/interview/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, history: interviewHistory, analysis: latestAnalysisData || {} }) });
    const data = await readJsonSafe(res);
    if (!res.ok || data.error) throw new Error(data.error || "Feedback error");
    byId("interview-feedback-loading").classList.add("hidden");
    byId("interview-feedback-text").textContent = data.feedback || "No feedback returned.";
    byId("interview-feedback-text").classList.remove("hidden");
    if (byId("restart-after-feedback")) byId("restart-after-feedback").classList.remove("hidden");
  } catch (e) {
    byId("interview-feedback-loading").classList.add("hidden");
    byId("interview-feedback-text").textContent = "⚠️ " + e.message;
    byId("interview-feedback-text").classList.remove("hidden");
  }
}

// ═══════════════════════════════════════════════════
// VOICE — TTS (AI speaks)
// ═══════════════════════════════════════════════════
function speakText(text) {
  if (!speechSynthesisApi || !text) return;
  stopSpeaking();
  const utter  = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ""));
  utter.rate   = 0.95; utter.pitch = 1.05; utter.volume = 1;
  const voices = speechSynthesisApi.getVoices();
  const preferred = voices.find(v => v.lang.startsWith("en") && v.localService) || voices.find(v => v.lang.startsWith("en"));
  if (preferred) utter.voice = preferred;
  utter.onstart = () => { if (byId("ai-speaking-bar")) byId("ai-speaking-bar").classList.remove("hidden"); };
  utter.onend = utter.onerror = () => { if (byId("ai-speaking-bar")) byId("ai-speaking-bar").classList.add("hidden"); currentUtterance = null; };
  currentUtterance = utter;
  speechSynthesisApi.speak(utter);
}

function stopSpeaking() {
  if (speechSynthesisApi) speechSynthesisApi.cancel();
  if (byId("ai-speaking-bar")) byId("ai-speaking-bar").classList.add("hidden");
  currentUtterance = null;
}

// ═══════════════════════════════════════════════════
// VOICE — SPEECH RECOGNITION (user speaks)
// ═══════════════════════════════════════════════════
function toggleVoiceInput() { voiceActive ? stopVoiceInput() : startVoiceInput(); }

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { alert("Voice input is not supported in this browser. Please type your answer."); return; }
  stopSpeaking();
  speechRecognition              = new SpeechRecognition();
  speechRecognition.continuous   = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang         = "en-US";
  const ta = byId("interview-user-input");
  let finalTranscript = "";
  speechRecognition.onresult = e => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    if (ta) ta.value = finalTranscript + (interim ? ` ${interim}` : "");
  };
  speechRecognition.onerror = e => { console.warn("Speech error:", e.error); stopVoiceInput(); };
  speechRecognition.onend   = () => { if (voiceActive) stopVoiceInput(); };
  speechRecognition.start();
  voiceActive = true;
  const btn = byId("voice-toggle-btn");
  if (btn) { btn.classList.add("voice-btn-active"); btn.innerHTML = '<i class="fas fa-stop"></i>'; }
  if (byId("voice-status")) byId("voice-status").classList.remove("hidden");
}

function stopVoiceInput() {
  if (speechRecognition) { try { speechRecognition.stop(); } catch (_) {} speechRecognition = null; }
  voiceActive = false;
  const btn = byId("voice-toggle-btn");
  if (btn) { btn.classList.remove("voice-btn-active"); btn.innerHTML = '<i class="fas fa-microphone"></i>'; }
  if (byId("voice-status")) byId("voice-status").classList.add("hidden");
}

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {
  checkVoiceSupport();
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }
});