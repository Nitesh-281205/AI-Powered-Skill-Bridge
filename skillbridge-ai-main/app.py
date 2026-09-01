"""
SkillBridge AI - Flask Backend
Powered by Groq (Llama 3.3 70B)
"""

import io
import json
import os
import re
from collections import defaultdict
from html import unescape
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from groq import Groq

try:
    import fitz
    PDF_OK = True
except ImportError:
    PDF_OK = False

try:
    from docx import Document
    DOCX_OK = True
except ImportError:
    DOCX_OK = False

try:
    import requests
    REQUESTS_OK = True
except ImportError:
    REQUESTS_OK = False

ROLE_CATALOG = {
    "Tech": [
        "Software Engineer",
        "Data Analyst",
        "Data Scientist",
        "Machine Learning Engineer",
        "Frontend Developer",
        "Backend Developer",
        "DevOps Engineer",
        "Cybersecurity Analyst",
        "Cloud Engineer",
        "AI Engineer",
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
        "Project Manager",
    ],
}

DIFFICULTY_LEVELS = {
    "beginner": {"question_count": 8, "duration_minutes": 8},
    "intermediate": {"question_count": 10, "duration_minutes": 10},
    "advanced": {"question_count": 12, "duration_minutes": 12},
}

app = Flask(__name__, static_folder=".")
CORS(app)

def load_local_env():
    env_candidates = [".env", "env"]
    base_dir = os.path.dirname(__file__)
    for filename in env_candidates:
        env_path = os.path.join(base_dir, filename)
        if not os.path.exists(env_path):
            continue
        try:
            with open(env_path, "r", encoding="utf-8") as env_file:
                for line in env_file:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = value
        except Exception as exc:
            print(f"Could not read {filename}: {exc}")


load_local_env()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

print("=" * 50)
print("SkillBridge AI")
print(f"API: {'Groq Connected' if client else 'MISSING KEY - set GROQ_API_KEY'}")
print(f"PDF: {'Yes' if PDF_OK else 'No'} | DOCX: {'Yes' if DOCX_OK else 'No'}")
print("=" * 50)


def extract_pdf(data):
    if not PDF_OK:
        return ""
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        return "\n".join(page.get_text() for page in doc).strip()
    except Exception:
        return ""


def extract_docx(data):
    if not DOCX_OK:
        return ""
    try:
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs).strip()
    except Exception:
        return ""


def extract_cv_from_request():
    cv_text = ""
    if "cv_file" in request.files:
        file = request.files["cv_file"]
        data = file.read()
        name = (file.filename or "").lower()
        if name.endswith(".pdf"):
            cv_text = extract_pdf(data)
        elif name.endswith((".docx", ".doc")):
            cv_text = extract_docx(data)
        elif name.endswith(".txt"):
            cv_text = data.decode("utf-8", errors="ignore")
    return cv_text or request.form.get("cv_text", "").strip()


def clean_json(raw):
    raw = (raw or "").strip()
    raw = re.sub(r"^```json\s*", "", raw)
    raw = re.sub(r"^```\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group()
    return json.loads(raw)


def groq_json(prompt, system, max_tokens=4000, temperature=0.5):
    if not client:
        return {"error": "API key missing. Set GROQ_API_KEY before running app.py."}
    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system + " Return valid JSON only. No markdown."},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return clean_json(response.choices[0].message.content)
    except json.JSONDecodeError as exc:
        print(f"JSON parse error: {exc}")
        return {"error": "Failed to parse AI JSON. Please try again."}
    except Exception as exc:
        message = str(exc)
        print(f"Groq error: {message}")
        lowered = message.lower()
        if "invalid api key" in lowered or "invalid_api_key" in lowered or "401" in lowered:
            return {"error": "Your Groq API key is invalid. Update GROQ_API_KEY in env or .env, then restart the server."}
        if "rate limit" in lowered or "429" in lowered:
            return {"error": "Groq rate limit reached. Please wait a moment and try again."}
        return {"error": message}


def groq_text(prompt, system="You are SkillBridge, a practical career coach.", max_tokens=1600):
    if not client:
        return {"error": "API key missing. Set GROQ_API_KEY before running app.py."}
    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            temperature=0.6,
            max_tokens=max_tokens,
        )
        return {"text": response.choices[0].message.content.strip()}
    except Exception as exc:
        message = str(exc)
        lowered = message.lower()
        if "invalid api key" in lowered or "invalid_api_key" in lowered or "401" in lowered:
            return {"error": "Your Groq API key is invalid. Update GROQ_API_KEY in env or .env, then restart the server."}
        if "rate limit" in lowered or "429" in lowered:
            return {"error": "Groq rate limit reached. Please wait a moment and try again."}
        return {"error": message}


def normalize_role_input(role_category="", selected_role="", custom_role="", job_title=""):
    category = (role_category or "").strip()
    chosen = (selected_role or "").strip()
    manual = (custom_role or "").strip()
    final_role = manual if chosen == "Other (Enter manually)" else chosen
    final_role = final_role or (job_title or "").strip() or "Target role"
    return {
        "role_category": category or "Custom",
        "selected_role": chosen or final_role,
        "custom_role": manual,
        "final_role": final_role,
    }


def ensure_list(value):
    return value if isinstance(value, list) else []


def enrich_analysis(result, role_meta, cv_text, job_desc):
    result = result if isinstance(result, dict) else {}
    result["job_title"] = result.get("job_title") or role_meta["final_role"]
    result["role_category"] = role_meta["role_category"]
    result["selected_role"] = role_meta["selected_role"]
    result["custom_role"] = role_meta["custom_role"]
    result["overall_match"] = int(max(0, min(100, result.get("overall_match", 0) or 0)))
    result["apply_readiness"] = int(
        max(0, min(100, result.get("apply_readiness", result["overall_match"]) or result["overall_match"]))
    )
    for key in ("strengths", "gaps", "roadmap", "career_advice", "cv_advice", "alternative_roles", "next_steps"):
        result[key] = ensure_list(result.get(key))
    result["current_skills"] = ensure_list(result.get("current_skills")) or [
        {"skill": item.get("skill", ""), "level": item.get("level", 0)} for item in result["strengths"][:8]
    ]
    result["required_skills"] = ensure_list(result.get("required_skills")) or [
        {
            "skill": item.get("skill", ""),
            "level": 90 if item.get("importance") == "critical" else 75,
        }
        for item in result["gaps"][:8]
    ]
    result["readiness_improvements"] = ensure_list(result.get("readiness_improvements")) or result["next_steps"][:3]
    result["summary"] = result.get("summary") or "SkillBridge could not generate a detailed summary for this role."
    result["industry"] = result.get("industry") or ("Technology" if role_meta["role_category"] == "Tech" else "General")
    result["_input"] = {
        "cv_text": (cv_text or "")[:12000],
        "job_description": (job_desc or "")[:12000],
        "job_title": role_meta["final_role"],
        "role_category": role_meta["role_category"],
        "selected_role": role_meta["selected_role"],
        "custom_role": role_meta["custom_role"],
    }
    return result


def parse_assessment_payload(payload):
    role_meta = normalize_role_input(
        payload.get("role_category", ""),
        payload.get("selected_role", payload.get("role", "")),
        payload.get("custom_role", ""),
        payload.get("role", ""),
    )
    difficulty = (payload.get("difficulty") or "intermediate").strip().lower()
    difficulty = difficulty if difficulty in DIFFICULTY_LEVELS else "intermediate"
    analysis = payload.get("analysis") or {}
    skills = payload.get("skills") or [g.get("skill") for g in ensure_list(analysis.get("gaps")) if g.get("skill")]
    skills = [skill for skill in skills if skill][:8]
    if not skills:
        skills = [s.get("skill") for s in ensure_list(analysis.get("required_skills")) if s.get("skill")][:8]
    return role_meta, difficulty, analysis, skills


def evaluate_assessment_answers(answers):
    total = len(answers)
    correct = 0
    breakdown = defaultdict(lambda: {"correct": 0, "total": 0})
    details = []
    for answer in answers:
        skill = (answer.get("skill") or "General").strip()
        selected = str(answer.get("selected", "")).strip()
        expected = str(answer.get("correct", "")).strip()
        is_correct = bool(selected and selected == expected)
        correct += 1 if is_correct else 0
        breakdown[skill]["total"] += 1
        breakdown[skill]["correct"] += 1 if is_correct else 0
        details.append(
            {
                "question": answer.get("question", ""),
                "skill": skill,
                "selected": selected,
                "correct": expected,
                "is_correct": is_correct,
                "explanation": answer.get("explanation", ""),
            }
        )

    skill_scores = []
    weak_skills = []
    for skill, row in breakdown.items():
        score = round((row["correct"] / row["total"]) * 100) if row["total"] else 0
        skill_scores.append({"skill": skill, "score": score, "correct": row["correct"], "total": row["total"]})
        if score < 70:
            weak_skills.append(skill)
    skill_scores.sort(key=lambda item: item["score"])

    overall = round((correct / total) * 100) if total else 0
    if overall >= 80:
        feedback = "Strong result. You are showing solid readiness across the tested skills."
    elif overall >= 60:
        feedback = "Good foundation with a few important weak areas to tighten before applying widely."
    else:
        feedback = "There are clear skill gaps right now. Focus on fundamentals and practical drills before your next round of applications."

    return {
        "score": overall,
        "correct": correct,
        "total": total,
        "skill_scores": skill_scores,
        "weak_skills": weak_skills,
        "feedback": feedback,
        "detailed_results": details,
    }


def analyse(cv_text, job_desc, role_meta):
    final_role = role_meta["final_role"]
    prompt = f"""You are SkillBridge, a world-class career coach and talent analyst across technology, medicine, law, finance, design, education, trades, hospitality, and more.

Analyse this CV against the target job.

CV / RESUME:
{cv_text if cv_text else "No CV provided - give general advice from the job description/title only."}

TARGET JOB:
Role category: {role_meta["role_category"]}
Selected role: {role_meta["selected_role"]}
Custom role: {role_meta["custom_role"] or "None"}
Job Title: {final_role}
Job Description: {job_desc or "Not provided"}

Return ONLY JSON:
{{
  "overall_match": <integer 0-100>,
  "apply_readiness": <integer 0-100>,
  "job_title": "{final_role}",
  "industry": "<detected industry>",
  "summary": "<2-3 sentence honest summary>",
  "current_skills": [{{"skill":"<skill>", "level":<integer 0-100>}}],
  "required_skills": [{{"skill":"<skill>", "level":<integer 0-100>}}],
  "readiness_improvements": ["<improvement>", "<improvement>", "<improvement>"],
  "strengths": [{{"skill": "<skill>", "level": <integer 0-100>, "note": "<why strong>"}}],
  "gaps": [{{"skill": "<missing skill>", "importance": "critical|important|nice-to-have", "note": "<why it matters>"}}],
  "experience_advice": {{"years_needed": "<e.g. 2-3 years>", "current_estimate": "<estimate or Unknown>", "advice": "<honest advice>"}},
  "roadmap": [{{"step": <number>, "title": "<area>", "why": "<why>", "duration": "<estimate>", "resources": [{{"name": "<resource>", "type": "course|book|project|certification|youtube|practice", "url": "<real URL or empty>", "free": <true|false>, "note": "<brief note>"}}]}}],
  "career_advice": ["<advice 1>", "<advice 2>", "<advice 3>", "<advice 4>", "<advice 5>"],
  "cv_advice": ["<CV tip 1>", "<CV tip 2>", "<CV tip 3>", "<CV tip 4>", "<CV tip 5>", "<CV tip 6>"],
  "alternative_roles": [{{"title": "<role>", "match": <integer 0-100>, "reason": "<why>"}}],
  "salary_insight": {{"range": "<range>", "entry": "<entry>", "senior": "<senior>", "note": "<context>"}},
  "next_steps": ["<action this week>", "<second action>", "<third action>"]
}}"""
    result = groq_json(prompt, "You are a precise career coach and talent analyst.", 4500, 0.7)
    if "error" in result:
        return result
    return enrich_analysis(result, role_meta, cv_text, job_desc)


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/skillbridge.js")
def skillbridge_js():
    return send_from_directory(".", "skillbridge.js")


@app.route("/api/roles")
def api_roles():
    return jsonify({"categories": ROLE_CATALOG})


@app.route("/api/analyse", methods=["POST"])
def api_analyse():
    try:
        cv_text = extract_cv_from_request()
        job_desc = request.form.get("job_description", "").strip()
        raw_job_title = request.form.get("job_title", "").strip()
        raw_selected_role = request.form.get("selected_role", "").strip()
        raw_custom_role = request.form.get("custom_role", "").strip()
        role_meta = normalize_role_input(
            request.form.get("role_category", ""),
            raw_selected_role,
            raw_custom_role,
            raw_job_title,
        )
        has_explicit_role = bool(raw_job_title or raw_custom_role or (raw_selected_role and raw_selected_role != "Other (Enter manually)"))
        if not job_desc and not has_explicit_role:
            return jsonify({"error": "Please provide a job description or job title."}), 400
        result = analyse(cv_text, job_desc, role_meta)
        if "error" in result:
            return jsonify(result), 500
        return jsonify(result)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(exc)}), 500


@app.route("/api/fetch-job-url", methods=["POST"])
def api_fetch_job_url():
    if not REQUESTS_OK:
        return jsonify({"error": "Install requests to enable job URL fetching."}), 500
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return jsonify({"error": "Enter a valid http or https job URL."}), 400
    try:
        session = requests.Session()
        session.trust_env = False
        page = session.get(
            url,
            timeout=12,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        page.raise_for_status()
        html = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", page.text)
        title_match = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
        text = unescape(re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", html))).strip()
        if "linkedin.com" in parsed.netloc and ("authwall" in page.url or len(text) < 500):
            return jsonify({
                "error": "LinkedIn blocks most automated job-page fetching. Open the posting in your browser, copy the job description, and paste it into SkillBridge."
            }), 400
        return jsonify({"title": unescape(title_match.group(1)).strip() if title_match else "", "description": text[:6000]})
    except requests.exceptions.ProxyError:
        return jsonify({
            "error": "Your system proxy settings blocked the request. SkillBridge now ignores proxy variables for job fetching; restart Flask and try again."
        }), 500
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "unknown"
        if "linkedin.com" in parsed.netloc:
            return jsonify({
                "error": f"LinkedIn returned HTTP {status}. LinkedIn commonly blocks automated fetches, so paste the job description manually."
            }), 400
        return jsonify({"error": f"The job page returned HTTP {status}. Paste the job description manually if the site blocks access."}), 500
    except Exception as exc:
        return jsonify({"error": f"Could not fetch that job page: {exc}"}), 500


@app.route("/api/assessment/start", methods=["POST"])
def api_assessment_start():
    data = request.get_json(silent=True) or {}
    role_meta, difficulty, analysis, skills = parse_assessment_payload(data)
    role = role_meta["final_role"]
    difficulty_meta = DIFFICULTY_LEVELS[difficulty]
    prompt = f"""Create a practical career skill assessment.
Role: {role}
Role category: {role_meta["role_category"]}
Difficulty: {difficulty}
Question count: {difficulty_meta["question_count"]}
Skills to test: {skills[:8]}
Analysis context: {json.dumps(analysis)[:7000]}

Return JSON:
{{"title":"<title>","duration_minutes":{difficulty_meta["duration_minutes"]},"difficulty":"{difficulty}","questions":[{{"question":"<question>","skill":"<skill>","difficulty":"{difficulty}","options":["A","B","C","D"],"correct":"<exact option text>","answer_index":0,"explanation":"<short explanation>"}}]}}"""
    result = groq_json(prompt, "You write accurate multiple-choice career skill assessments.", 3500)
    if "error" in result:
        return jsonify(result), 500
    result["role"] = role
    result["role_category"] = role_meta["role_category"]
    result["difficulty"] = difficulty
    result["duration_minutes"] = int(result.get("duration_minutes") or difficulty_meta["duration_minutes"])
    result["questions"] = ensure_list(result.get("questions"))[: difficulty_meta["question_count"]]
    return jsonify(result)


@app.route("/api/assessment/evaluate", methods=["POST"])
def api_assessment_evaluate():
    data = request.get_json(silent=True) or {}
    answers = ensure_list(data.get("answers"))
    return jsonify(evaluate_assessment_answers(answers))


@app.route("/api/adaptive-roadmap", methods=["POST"])
def api_adaptive_roadmap():
    data = request.get_json(silent=True) or {}
    prompt = f"""Combine resume/job analysis with assessment results and create an adaptive roadmap.
Analysis: {json.dumps(data.get('analysis', {}))[:8500]}
Assessment: {json.dumps(data.get('assessment', {}))[:5000]}
Return JSON:
{{"focus_summary":"<one paragraph>","roadmap":[{{"step":1,"title":"<priority>","why":"<why now>","duration":"<estimate>","resources":[{{"name":"<resource or practice task>","type":"course|book|project|certification|youtube|practice","url":"","free":true,"note":"<note>"}}]}}]}}"""
    result = groq_json(prompt, "You create adaptive career learning roadmaps.", 3200)
    return jsonify(result), 500 if "error" in result else 200


@app.route("/api/rewrite-cv", methods=["POST"])
def api_rewrite_cv():
    data = request.get_json(silent=True) or {}
    cv_text = (data.get("cv_text") or "").strip()
    analysis = data.get("analysis") or {}
    if not cv_text:
        return jsonify({"error": "Paste or upload CV text before using Improve CV."}), 400
    prompt = f"""Rewrite this CV for the target role while staying truthful. Do not invent employers, degrees, dates, certifications, or metrics.
Target role: {analysis.get('job_title', '')}
Industry: {analysis.get('industry', '')}
CV advice: {json.dumps(analysis.get('cv_advice', []))}
CV:
{cv_text[:12000]}
Return JSON: {{"rewritten_cv":"<ATS-friendly CV text>","changes":["<change>"],"keywords":["<keyword>"]}}"""
    result = groq_json(prompt, "You are an expert CV writer.", 3500)
    return jsonify(result), 500 if "error" in result else 200


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message is required."}), 400
    prompt = f"""Use this SkillBridge analysis to answer the user's career question.
Analysis: {json.dumps(data.get('analysis', {}))[:8000]}
Question: {message}
Be concise, specific, and actionable."""
    result = groq_text(prompt)
    return jsonify(result), 500 if "error" in result else 200


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "model": MODEL, "api": "groq"})


if __name__ == "__main__":
    print("\nRunning at http://localhost:5000\n")
    app.run(debug=True, host="0.0.0.0", port=5000)

