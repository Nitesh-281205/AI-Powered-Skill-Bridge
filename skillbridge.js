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
roleEl.innerHTML = roles.map(role => `<option value="${role}">${role}</option>`).join("");
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
  if (payload.final_role && byId("jt") && !byId("jt").value.trim()) {
    byId("jt").value = payload.final_role;
  }

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
// (rest of your file continues exactly the same…)
document.addEventListener("DOMContentLoaded", () => {
  initializeRoleSelectors();
});

})();