"""
SkillBridge AI - Flask Backend
Powered by Groq (GPT-OSS 120B, with Qwen3.6 27B fallback)
"""

import io
import json
import os
import re
import secrets
import sqlite3
from collections import defaultdict
from datetime import datetime
from functools import wraps
from html import unescape
from urllib.parse import urlparse

from flask import Flask, g, jsonify, request, send_from_directory, session
from flask_cors import CORS
from groq import Groq
from werkzeug.security import check_password_hash, generate_password_hash

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
        "Software Engineer", "Data Analyst", "Data Scientist", "Machine Learning Engineer",
        "Frontend Developer", "Backend Developer", "DevOps Engineer", "Cybersecurity Analyst",
        "Cloud Engineer", "AI Engineer",
    ],
    "Non-Tech": [
        "Business Analyst", "Marketing Manager", "Sales Executive", "HR Manager",
        "Product Manager", "Operations Manager", "Financial Analyst", "Accountant",
        "Customer Success Manager", "Project Manager",
    ],
}
DIFFICULTY_LEVELS = {
    "beginner": {"question_count": 8, "duration_minutes": 8},
    "intermediate": {"question_count": 10, "duration_minutes": 10},
    "advanced": {"question_count": 12, "duration_minutes": 12},
}
PLATFORM_URLS = {
    "Coursera": "https://www.coursera.org/search?query=",
    "Udemy": "https://www.udemy.com/courses/search/?q=",
    "YouTube": "https://www.youtube.com/results?search_query=",
    "freeCodeCamp": "https://www.freecodecamp.org/learn",
    "edX": "https://www.edx.org/search?q=",
    "LinkedIn Learning": "https://www.linkedin.com/learning/search?keywords=",
    "Kaggle": "https://www.kaggle.com/learn",
    "Google": "https://grow.google/certificates/",
    "Microsoft Learn": "https://learn.microsoft.com/en-us/training/browse/?terms=",
    "DataCamp": "https://www.datacamp.com/search?q=",
}

BASE_DIR = os.path.dirname(__file__)
DB_PATH = os.path.join(BASE_DIR, "skillbridge.db")

app = Flask(__name__, static_folder=".")
CORS(app)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", secrets.token_hex(32))
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


def load_local_env():
    for filename in [".env", "env"]:
        path = os.path.join(BASE_DIR, filename)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8-sig") as env_file:
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
            print(f"Env read error {filename}: {exc}")


load_local_env()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
FALLBACK_MODEL = os.environ.get("GROQ_FALLBACK_MODEL", "qwen/qwen3.6-27b")
DEFAULT_ADMIN_EMAIL = os.environ.get("SKILLBRIDGE_ADMIN_EMAIL", "admin@skillbridge.ai")
DEFAULT_ADMIN_PASSWORD = os.environ.get("SKILLBRIDGE_ADMIN_PASSWORD", "Nitesh@2005")
client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

print("=" * 50)
print("SkillBridge AI")
print(f"API: {'Groq Connected' if client else 'MISSING KEY'}")
print(f"Model: {MODEL} (fallback: {FALLBACK_MODEL})")
print(f"PDF: {'Yes' if PDF_OK else 'No'} | DOCX: {'Yes' if DOCX_OK else 'No'}")
print("=" * 50)


def utc_now():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    cursor = db.cursor()
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_login TEXT
        );

        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            job_title TEXT,
            role_category TEXT,
            match_score INTEGER,
            readiness_score INTEGER,
            result_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            analysis_id INTEGER,
            role TEXT,
            difficulty TEXT,
            score INTEGER,
            correct_answers INTEGER,
            total_questions INTEGER,
            result_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(analysis_id) REFERENCES analyses(id)
        );

        CREATE TABLE IF NOT EXISTS chat_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            answer TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS interviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            role TEXT,
            history_json TEXT,
            feedback TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        """
    )
    db.commit()
    cursor.execute("SELECT id FROM users WHERE email = ?", (DEFAULT_ADMIN_EMAIL.lower(),))
    if cursor.fetchone() is None:
        cursor.execute(
            """
            INSERT INTO users (first_name, last_name, email, password_hash, is_admin, created_at, last_login)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (
                "Admin",
                "User",
                DEFAULT_ADMIN_EMAIL.lower(),
                generate_password_hash(DEFAULT_ADMIN_PASSWORD),
                utc_now(),
                utc_now(),
            ),
        )
        db.commit()
    db.close()


init_db()


def row_to_user(row):
    return {
        "id": row["id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "name": f"{row['first_name']} {row['last_name']}".strip(),
        "email": row["email"],
        "is_admin": bool(row["is_admin"]),
        "created_at": row["created_at"],
        "last_login": row["last_login"],
    }


def get_user_by_id(user_id):
    row = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return row_to_user(row) if row else None


def current_user():
    user_id = session.get("user_id")
    return get_user_by_id(user_id) if user_id else None


def require_login(admin=False):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                return jsonify({"error": "Please sign in to continue."}), 401
            if admin and not user["is_admin"]:
                return jsonify({"error": "Admin access required."}), 403
            g.current_user = user
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def save_analysis_record(user_id, result):
    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO analyses (user_id, job_title, role_category, match_score, readiness_score, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            result.get("job_title"),
            result.get("role_category"),
            int(result.get("overall_match", 0)),
            int(result.get("apply_readiness", result.get("overall_match", 0))),
            json.dumps(result),
            utc_now(),
        ),
    )
    db.commit()
    return cursor.lastrowid


def save_assessment_record(user_id, payload, evaluation):
    db = get_db()
    cursor = db.execute(
        """
        INSERT INTO assessments (user_id, analysis_id, role, difficulty, score, correct_answers, total_questions, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            payload.get("analysis_id"),
            payload.get("role"),
            payload.get("difficulty"),
            int(evaluation.get("score", 0)),
            int(evaluation.get("correct", 0)),
            int(evaluation.get("total", 0)),
            json.dumps({"payload": payload, "evaluation": evaluation}),
            utc_now(),
        ),
    )
    db.commit()
    return cursor.lastrowid


def save_chat_record(user_id, message, answer):
    db = get_db()
    db.execute(
        "INSERT INTO chat_logs (user_id, message, answer, created_at) VALUES (?, ?, ?, ?)",
        (user_id, message, answer, utc_now()),
    )
    db.commit()


def save_interview_record(user_id, role, history, feedback=""):
    db = get_db()
    db.execute(
        "INSERT INTO interviews (user_id, role, history_json, feedback, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, role, json.dumps(history), feedback, utc_now()),
    )
    db.commit()


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


def _groq_complete(messages, max_tokens, temperature):
    """Call the primary model; on failure (rate limit, decommission, etc.) retry once on the fallback model."""
    try:
        return client.chat.completions.create(
            model=MODEL,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    except Exception as exc:
        msg = str(exc).lower()
        if FALLBACK_MODEL and FALLBACK_MODEL != MODEL and (
            "rate limit" in msg or "429" in msg or "decommission" in msg or "not found" in msg or "not exist" in msg
        ):
            return client.chat.completions.create(
                model=FALLBACK_MODEL,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        raise


def ai_json(prompt, system, max_tokens=4500, temperature=0.5):
    if not client:
        return {"error": "API key missing."}
    try:
        response = _groq_complete(
            [
                {"role": "system", "content": system + " Return valid JSON only. No markdown."},
                {"role": "user", "content": prompt},
            ],
            max_tokens,
            temperature,
        )
        return clean_json(response.choices[0].message.content)
    except json.JSONDecodeError:
        return {"error": "Failed to parse AI JSON. Please try again."}
    except Exception as exc:
        msg = str(exc)
        low = msg.lower()
        if "invalid api key" in low or "401" in low:
            return {"error": "Invalid Groq API key."}
        if "rate limit" in low or "429" in low:
            return {"error": "Groq rate limit. Wait and retry."}
        return {"error": msg}


def ai_text(prompt, system="You are SkillBridge, a career coach.", max_tokens=1600):
    if not client:
        return {"error": "API key missing."}
    try:
        response = _groq_complete(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_tokens,
            0.6,
        )
        return {"text": response.choices[0].message.content.strip()}
    except Exception as exc:
        msg = str(exc)
        low = msg.lower()
        if "invalid api key" in low or "401" in low:
            return {"error": "Invalid Groq API key."}
        if "rate limit" in low or "429" in low:
            return {"error": "Groq rate limit. Wait and retry."}
        return {"error": msg}


def ai_chat(messages, system, max_tokens=1200):
    if not client:
        return {"error": "API key missing."}
    try:
        response = _groq_complete(
            [{"role": "system", "content": system}] + messages,
            max_tokens,
            0.7,
        )
        return {"text": response.choices[0].message.content.strip()}
    except Exception as exc:
        return {"error": str(exc)}


def normalize_role(role_category="", selected_role="", custom_role="", job_title=""):
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


def patch_courses(courses):
    for course in courses:
        url = (course.get("url") or "").strip()
        platform = (course.get("platform") or "").strip()
        skill = (course.get("skill") or course.get("name") or "").replace(" ", "+")
        if not url or not url.startswith("http"):
            base = PLATFORM_URLS.get(platform, "https://www.google.com/search?q=")
            course["url"] = base + skill if not base.endswith("/learn") else base
        course["free"] = bool(course.get("free", False))
    return courses


def enrich(result, role_meta, cv_text, job_desc):
    result = result if isinstance(result, dict) else {}
    result["job_title"] = result.get("job_title") or role_meta["final_role"]
    result["role_category"] = role_meta["role_category"]
    result["selected_role"] = role_meta["selected_role"]
    result["custom_role"] = role_meta["custom_role"]
    result["overall_match"] = int(max(0, min(100, result.get("overall_match", 0) or 0)))
    result["apply_readiness"] = int(max(0, min(100, result.get("apply_readiness", result["overall_match"]) or result["overall_match"])))
    for key in ("strengths", "gaps", "roadmap", "career_advice", "cv_advice", "alternative_roles", "next_steps", "recommended_courses"):
        result[key] = ensure_list(result.get(key))
    result["current_skills"] = ensure_list(result.get("current_skills")) or [
        {"skill": item.get("skill", ""), "level": item.get("level", 0)} for item in result["strengths"][:8]
    ]
    result["required_skills"] = ensure_list(result.get("required_skills")) or [
        {"skill": item.get("skill", ""), "level": 90 if item.get("importance") == "critical" else 75} for item in result["gaps"][:8]
    ]
    result["readiness_improvements"] = ensure_list(result.get("readiness_improvements")) or result["next_steps"][:3]
    result["summary"] = result.get("summary") or "SkillBridge could not generate a summary."
    result["industry"] = result.get("industry") or ("Technology" if role_meta["role_category"] == "Tech" else "General")
    result["recommended_courses"] = patch_courses(result["recommended_courses"])
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
    role_meta = normalize_role(
        payload.get("role_category", ""),
        payload.get("selected_role", payload.get("role", "")),
        payload.get("custom_role", ""),
        payload.get("role", ""),
    )
    difficulty = (payload.get("difficulty") or "intermediate").strip().lower()
    difficulty = difficulty if difficulty in DIFFICULTY_LEVELS else "intermediate"
    analysis = payload.get("analysis") or {}
    skills = payload.get("skills") or [item.get("skill") for item in ensure_list(analysis.get("gaps")) if item.get("skill")]
    skills = [skill for skill in skills if skill][:8]
    if not skills:
        skills = [item.get("skill") for item in ensure_list(analysis.get("required_skills")) if item.get("skill")][:8]
    return role_meta, difficulty, analysis, skills


def evaluate_answers(answers):
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
        details.append({
            "question": answer.get("question", ""),
            "skill": skill,
            "selected": selected,
            "correct": expected,
            "is_correct": is_correct,
            "explanation": answer.get("explanation", ""),
            "options": answer.get("options", []),
        })
    scores = []
    weak_skills = []
    for skill, row in breakdown.items():
        score = round((row["correct"] / row["total"]) * 100) if row["total"] else 0
        scores.append({"skill": skill, "score": score, "correct": row["correct"], "total": row["total"]})
        if score < 70:
            weak_skills.append(skill)
    scores.sort(key=lambda item: item["score"])
    overall = round((correct / total) * 100) if total else 0
    feedback = (
        "Strong result. You are showing solid readiness." if overall >= 80 else
        "Good foundation - tighten a few weak areas before applying widely." if overall >= 60 else
        "Clear skill gaps exist. Focus on fundamentals and practice before applying."
    )
    return {
        "score": overall,
        "correct": correct,
        "total": total,
        "skill_scores": scores,
        "weak_skills": weak_skills,
        "feedback": feedback,
        "detailed_results": details,
    }


def analyse(cv_text, job_desc, role_meta):
    final_role = role_meta["final_role"]
    platforms = ", ".join(PLATFORM_URLS.keys())
    prompt = f"""You are SkillBridge, a world-class career coach and talent analyst.

Analyse this CV against the target job.

CV / RESUME:
{cv_text if cv_text else 'No CV provided - give general advice from the job description/title only.'}

TARGET JOB:
Role category: {role_meta['role_category']}
Selected role: {role_meta['selected_role']}
Custom role: {role_meta['custom_role'] or 'None'}
Job Title: {final_role}
Job Description: {job_desc or 'Not provided'}

Return ONLY valid JSON (no markdown):
{{
  "overall_match": <int 0-100>,
  "apply_readiness": <int 0-100>,
  "job_title": "{final_role}",
  "industry": "<industry>",
  "summary": "<2-3 sentence honest summary>",
  "current_skills": [{{"skill":"<s>","level":<int>}}],
  "required_skills": [{{"skill":"<s>","level":<int>}}],
  "readiness_improvements": ["<r>","<r>","<r>"],
  "strengths": [{{"skill":"<s>","level":<int>,"note":"<why>"}}],
  "gaps": [{{"skill":"<s>","importance":"critical|important|nice-to-have","note":"<why>"}}],
  "recommended_courses": [{{"name":"<full course title>","platform":"<one of: {platforms}>","skill":"<skill>","url":"<working URL>","free":<bool>,"note":"<one line>"}}],
  "experience_advice": {{"years_needed":"<e.g. 2-3>","current_estimate":"<est>","advice":"<advice>"}},
  "roadmap": [{{"step":<n>,"title":"<area>","why":"<why>","duration":"<time>","resources":[{{"name":"<name>","type":"course|book|project|certification|youtube|practice","url":"<url>","free":<bool>,"note":"<note>"}}]}}],
  "career_advice": ["<a>","<a>","<a>","<a>","<a>"],
  "cv_advice": ["<t>","<t>","<t>","<t>","<t>","<t>"],
  "alternative_roles": [{{"title":"<role>","match":<int>,"reason":"<why>"}}],
  "salary_insight": {{"range":"<range in INR>","entry":"<entry in INR>","senior":"<senior in INR>","note":"<context>"}},
  "next_steps": ["<action>","<action>","<action>"]
}}

RULES:
- recommended_courses: 6-10 courses, mix free/paid, cover every critical gap, platform from list: {platforms}
- ALL salary figures must be in Indian Rupees using Indian number format
- Base salary on India market rates
- Always fill explanation fields
"""
    result = ai_json(prompt, "You are a precise career coach and talent analyst.", 5000, 0.7)
    if "error" in result:
        return result
    return enrich(result, role_meta, cv_text, job_desc)


INTERVIEW_SYSTEM = """You are an expert interviewer conducting a professional job interview.
Your job is to ask one focused question per turn, listen to the candidate's answer, and then ask the next relevant question.
Ask a mix of technical, behavioural, and situational questions relevant to the role.
Keep responses concise. After 7-8 questions, set finished=true.
Always respond in JSON: {"response":"<comment + next question>","finished":<bool>,"question_number":<int>}"""


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/skillbridge.js")
def sb_js():
    return send_from_directory(".", "skillbridge.js")


@app.route("/auth-admin.js")
def auth_admin_js():
    return send_from_directory(".", "auth-admin.js")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "model": MODEL, "api": "groq", "auth": bool(client)})


@app.route("/api/auth/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not first_name or not last_name or not email or not password:
        return jsonify({"error": "Please fill in all registration fields."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400
    db = get_db()
    exists = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if exists:
        return jsonify({"error": "An account with this email already exists."}), 409
    cursor = db.execute(
        """
        INSERT INTO users (first_name, last_name, email, password_hash, is_admin, created_at, last_login)
        VALUES (?, ?, ?, ?, 0, ?, ?)
        """,
        (first_name, last_name, email, generate_password_hash(password), utc_now(), utc_now()),
    )
    db.commit()
    user = get_user_by_id(cursor.lastrowid)
    session["user_id"] = user["id"]
    return jsonify({"user": user})


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401
    db.execute("UPDATE users SET last_login = ? WHERE id = ?", (utc_now(), row["id"]))
    db.commit()
    session["user_id"] = row["id"]
    return jsonify({"user": get_user_by_id(row["id"])})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me")
def api_me():
    return jsonify({"user": current_user()})


@app.route("/api/user/dashboard")
@require_login()
def api_user_dashboard():
    user = g.current_user
    db = get_db()
    analyses = [dict(row) for row in db.execute(
        "SELECT id, job_title, role_category, match_score, readiness_score, created_at FROM analyses WHERE user_id = ? ORDER BY id DESC LIMIT 12",
        (user["id"],),
    ).fetchall()]
    assessments = [dict(row) for row in db.execute(
        "SELECT id, role, difficulty, score, correct_answers, total_questions, created_at FROM assessments WHERE user_id = ? ORDER BY id DESC LIMIT 12",
        (user["id"],),
    ).fetchall()]
    chat_count = db.execute("SELECT COUNT(*) AS c FROM chat_logs WHERE user_id = ?", (user["id"],)).fetchone()["c"]
    interview_count = db.execute("SELECT COUNT(*) AS c FROM interviews WHERE user_id = ?", (user["id"],)).fetchone()["c"]
    return jsonify({
        "user": user,
        "stats": {
            "analysis_count": len(analyses),
            "assessment_count": len(assessments),
            "chat_count": chat_count,
            "interview_count": interview_count,
        },
        "analyses": analyses,
        "assessments": assessments,
    })


@app.route("/api/admin/dashboard")
@require_login(admin=True)
def api_admin_dashboard():
    db = get_db()
    totals = {
        "users": db.execute("SELECT COUNT(*) AS c FROM users WHERE is_admin = 0").fetchone()["c"],
        "admins": db.execute("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1").fetchone()["c"],
        "analyses": db.execute("SELECT COUNT(*) AS c FROM analyses").fetchone()["c"],
        "assessments": db.execute("SELECT COUNT(*) AS c FROM assessments").fetchone()["c"],
        "chats": db.execute("SELECT COUNT(*) AS c FROM chat_logs").fetchone()["c"],
        "interviews": db.execute("SELECT COUNT(*) AS c FROM interviews").fetchone()["c"],
    }
    recent_users = [dict(row) for row in db.execute(
        "SELECT id, first_name, last_name, email, is_admin, created_at, last_login FROM users ORDER BY id DESC LIMIT 10"
    ).fetchall()]
    recent_analyses = [dict(row) for row in db.execute(
        """
        SELECT analyses.id, analyses.job_title, analyses.match_score, analyses.readiness_score, analyses.created_at,
               users.first_name || ' ' || users.last_name AS user_name, users.email
        FROM analyses JOIN users ON analyses.user_id = users.id
        ORDER BY analyses.id DESC LIMIT 10
        """
    ).fetchall()]
    user_activity = [dict(row) for row in db.execute(
        """
        SELECT users.id, users.first_name || ' ' || users.last_name AS user_name, users.email,
               COUNT(DISTINCT analyses.id) AS analyses_count,
               COUNT(DISTINCT assessments.id) AS assessments_count,
               MAX(analyses.created_at) AS latest_analysis
        FROM users
        LEFT JOIN analyses ON analyses.user_id = users.id
        LEFT JOIN assessments ON assessments.user_id = users.id
        GROUP BY users.id
        ORDER BY analyses_count DESC, assessments_count DESC, users.id DESC
        LIMIT 15
        """
    ).fetchall()]
    return jsonify({
        "totals": totals,
        "recent_users": recent_users,
        "recent_analyses": recent_analyses,
        "user_activity": user_activity,
        "admin": g.current_user,
        "default_admin": {"email": DEFAULT_ADMIN_EMAIL},
    })


@app.route("/api/admin/users/<int:user_id>")
@require_login(admin=True)
def api_admin_user_detail(user_id):
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return jsonify({"error": "User not found."}), 404
    analyses = [dict(item) for item in db.execute(
        "SELECT id, job_title, role_category, match_score, readiness_score, created_at FROM analyses WHERE user_id = ? ORDER BY id DESC LIMIT 20",
        (user_id,),
    ).fetchall()]
    assessments = [dict(item) for item in db.execute(
        "SELECT id, role, difficulty, score, correct_answers, total_questions, created_at FROM assessments WHERE user_id = ? ORDER BY id DESC LIMIT 20",
        (user_id,),
    ).fetchall()]
    chats = [dict(item) for item in db.execute(
        "SELECT id, message, answer, created_at FROM chat_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10",
        (user_id,),
    ).fetchall()]
    interviews = [dict(item) for item in db.execute(
        "SELECT id, role, feedback, created_at FROM interviews WHERE user_id = ? ORDER BY id DESC LIMIT 10",
        (user_id,),
    ).fetchall()]
    return jsonify({
        "user": row_to_user(row),
        "analyses": analyses,
        "assessments": assessments,
        "chats": chats,
        "interviews": interviews,
    })


@app.route("/api/roles")
def api_roles():
    return jsonify({"categories": ROLE_CATALOG})


@app.route("/api/analyse", methods=["POST"])
@require_login()
def api_analyse():
    cv_text = extract_cv_from_request()
    job_desc = request.form.get("job_description", "").strip()
    raw_title = request.form.get("job_title", "").strip()
    raw_selected = request.form.get("selected_role", "").strip()
    raw_custom = request.form.get("custom_role", "").strip()
    role_meta = normalize_role(request.form.get("role_category", ""), raw_selected, raw_custom, raw_title)
    has_role = bool(raw_title or raw_custom or (raw_selected and raw_selected != "Other (Enter manually)"))
    if not job_desc and not has_role:
        return jsonify({"error": "Please provide a job description or job title."}), 400
    result = analyse(cv_text, job_desc, role_meta)
    if "error" in result:
        return jsonify(result), 500
    analysis_id = save_analysis_record(g.current_user["id"], result)
    result["analysis_id"] = analysis_id
    return jsonify(result)


@app.route("/api/fetch-job-url", methods=["POST"])
def api_fetch_job_url():
    if not REQUESTS_OK:
        return jsonify({"error": "Install requests library."}), 500
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return jsonify({"error": "Enter a valid http/https URL."}), 400
    try:
        request_session = requests.Session()
        request_session.trust_env = False
        page = request_session.get(
            url,
            timeout=12,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        page.raise_for_status()
        html = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", page.text)
        title_match = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
        text = unescape(re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", html))).strip()
        if "linkedin.com" in parsed.netloc and ("authwall" in page.url or len(text) < 500):
            return jsonify({"error": "LinkedIn blocks automated fetching. Paste the job description manually."}), 400
        return jsonify({"title": unescape(title_match.group(1)).strip() if title_match else "", "description": text[:6000]})
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        if "linkedin.com" in parsed.netloc:
            return jsonify({"error": f"LinkedIn returned HTTP {status}. Paste the description manually."}), 400
        return jsonify({"error": f"HTTP {status}. Paste the description manually."}), 500
    except Exception as exc:
        return jsonify({"error": f"Could not fetch: {exc}"}), 500


@app.route("/api/assessment/start", methods=["POST"])
@require_login()
def api_assessment_start():
    data = request.get_json(silent=True) or {}
    role_meta, difficulty, analysis, skills = parse_assessment_payload(data)
    role = role_meta["final_role"]
    diff_meta = DIFFICULTY_LEVELS[difficulty]
    prompt = f"""Create a practical career skill assessment.
Role: {role} | Category: {role_meta['role_category']} | Difficulty: {difficulty}
Question count: {diff_meta['question_count']} | Skills to test: {skills[:8]}
Analysis context: {json.dumps(analysis)[:7000]}

Return JSON:
{{"title":"<title>","duration_minutes":{diff_meta['duration_minutes']},"difficulty":"{difficulty}",
"questions":[{{
  "question":"<question text>","skill":"<skill being tested>","difficulty":"{difficulty}",
  "options":["<option A>","<option B>","<option C>","<option D>"],
  "correct":"<exact text of one of the four options>",
  "answer_index":0,
  "explanation":"<clear explanation>"
}}]}}
"""
    result = ai_json(prompt, "You write accurate multiple-choice career skill assessments.", 3500)
    if "error" in result:
        return jsonify(result), 500
    result["role"] = role
    result["role_category"] = role_meta["role_category"]
    result["difficulty"] = difficulty
    result["duration_minutes"] = int(result.get("duration_minutes") or diff_meta["duration_minutes"])
    result["questions"] = ensure_list(result.get("questions"))[:diff_meta["question_count"]]
    return jsonify(result)


@app.route("/api/assessment/evaluate", methods=["POST"])
@require_login()
def api_assessment_evaluate():
    data = request.get_json(silent=True) or {}
    evaluation = evaluate_answers(ensure_list(data.get("answers")))
    assessment_id = save_assessment_record(g.current_user["id"], data, evaluation)
    evaluation["assessment_id"] = assessment_id
    return jsonify(evaluation)


@app.route("/api/interview", methods=["POST"])
@require_login()
def api_interview():
    data = request.get_json(silent=True) or {}
    role = data.get("role", "Software Engineer")
    history = data.get("history", [])
    question_index = int(data.get("question_index", 0))
    analysis = data.get("analysis", {})
    gaps = [item.get("skill", "") for item in ensure_list(analysis.get("gaps", []))][:5]
    system = f"""{INTERVIEW_SYSTEM}
Role being interviewed for: {role}
Key skill gaps to probe: {', '.join(gaps) if gaps else 'general skills'}
Current question number: {question_index + 1} of 8"""
    messages = [{"role": item["role"], "content": item["content"]} for item in history if item.get("role") in ("user", "assistant")]
    if not messages:
        return jsonify({"response": f"Tell me about yourself and what draws you to the {role} role.", "finished": False, "question_number": 1})
    result = ai_chat(messages, system, max_tokens=400)
    if "error" in result:
        return jsonify(result), 500
    raw = result["text"]
    try:
        parsed = clean_json(raw)
        return jsonify({
            "response": parsed.get("response", raw),
            "finished": parsed.get("finished", False) or question_index >= 7,
            "question_number": question_index + 1,
        })
    except Exception:
        return jsonify({"response": raw, "finished": question_index >= 7, "question_number": question_index + 1})


@app.route("/api/interview/feedback", methods=["POST"])
@require_login()
def api_interview_feedback():
    data = request.get_json(silent=True) or {}
    role = data.get("role", "the target role")
    history = data.get("history", [])
    analysis = data.get("analysis", {})
    user_answers = [(i + 1, item["content"]) for i, item in enumerate(history) if item.get("role") == "user"]
    ai_questions = [(i + 1, item["content"]) for i, item in enumerate(history) if item.get("role") == "assistant"]
    qa_text = "\n\n".join([f"Q{q[0]}: {q[1]}\nA: {a[1]}" for q, a in zip(ai_questions, user_answers)]) if user_answers else "No answers recorded."
    gaps = [item.get("skill", "") for item in ensure_list(analysis.get("gaps", []))][:5]
    prompt = f"""You are a senior interviewer. Provide detailed, honest feedback on this candidate's interview performance for the role of {role}.

Interview transcript:
{qa_text[:6000]}

Known skill gaps: {', '.join(gaps) if gaps else 'not provided'}

Write structured feedback covering overall impression, communication, technical knowledge, behavioural quality, top strengths, top improvements, and a final score out of 10."""
    result = ai_text(prompt, "You are an expert interview coach.", max_tokens=800)
    if "error" in result:
        return jsonify(result), 500
    save_interview_record(g.current_user["id"], role, history, result["text"])
    return jsonify({"feedback": result["text"]})


@app.route("/api/adaptive-roadmap", methods=["POST"])
@require_login()
def api_adaptive_roadmap():
    data = request.get_json(silent=True) or {}
    prompt = f"""Combine analysis + assessment and create an adaptive roadmap.
Analysis: {json.dumps(data.get('analysis', {}))[:8500]}
Assessment: {json.dumps(data.get('assessment', {}))[:5000]}
Return JSON: {{"focus_summary":"<para>","roadmap":[{{"step":1,"title":"<t>","why":"<w>","duration":"<d>","resources":[{{"name":"<n>","type":"course|book|project|certification|youtube|practice","url":"","free":true,"note":"<n>"}}]}}]}}"""
    result = ai_json(prompt, "You create adaptive career learning roadmaps.", 3200)
    return jsonify(result), (500 if "error" in result else 200)


@app.route("/api/chat", methods=["POST"])
@require_login()
def api_chat():
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message required."}), 400
    prompt = f"Analysis: {json.dumps(data.get('analysis', {}))[:8000]}\nQuestion: {message}\nBe concise and actionable."
    result = ai_text(prompt)
    if "error" in result:
        return jsonify(result), 500
    save_chat_record(g.current_user["id"], message, result["text"])
    return jsonify(result)


if __name__ == "__main__":
    print("\nRunning at http://localhost:5000\n")
    app.run(debug=True, host="0.0.0.0", port=5000)