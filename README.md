# SkillBridge AI

SkillBridge AI is a Flask-based career intelligence app that helps users compare a CV against a target role, identify skill gaps, generate learning roadmaps, take AI-generated assessments, practice mock interviews, and export a formatted project-style report.

The current project includes:

- mandatory user registration and sign-in
- persistent SQLite-backed user data
- admin tracking dashboard
- CV and job-description analysis powered by Groq (GPT-OSS 120B, with Qwen3.6 27B fallback)
- role-based skill assessment with answer review
- adaptive roadmap generation
- AI mock interview with feedback
- PDF-style report export with a custom front page

## Core Features

### Career Analysis

- CV upload: `PDF`, `DOCX`, `DOC`, `TXT`
- pasted CV text support
- target role selection by category
- job description paste or job URL fetch
- overall match score
- apply readiness score
- strengths and skill gap detection
- roadmap with recommended resources
- India-focused salary insights
- CV improvement tips
- alternative role suggestions

### Assessment and Interview

- AI-generated MCQ assessments
- beginner / intermediate / advanced difficulty
- answer evaluation with explanations
- saved assessment history
- AI mock interview flow
- interview feedback storage

### Authentication and Persistence

- mandatory registration for protected workflows
- secure password hashing
- Flask session-based login
- SQLite storage for:
  - users
  - analyses
  - assessments
  - chat logs
  - interview feedback

### Admin Workflow

- separate admin access path
- total users / analyses / assessments / chats / interviews
- recent registrations
- recent analysis activity
- per-user drilldown for stored records

## Project Structure

```text
skillbridge-ai-main/
├── app.py            # Flask backend, auth, SQLite, Groq routes
├── run.py            # Local entry point
├── index.html        # Main frontend UI
├── skillbridge.js    # Main frontend logic
├── auth-admin.js     # Login/register/dashboard/admin UI logic
├── skillbridge.db    # SQLite database created at runtime
├── requirements.txt  # Python dependencies
├── .env              # Local environment variables (not for Git)
└── README.md         # Project documentation
```

## Tech Stack

- **Backend:** Flask, Flask-CORS
- **Frontend:** HTML, Tailwind CSS, Vanilla JavaScript
- **AI Model:** GPT-OSS 120B via Groq (auto-falls back to Qwen3.6 27B)
- **Database:** SQLite
- **Auth:** Flask session cookies + Werkzeug password hashing
- **PDF Parsing:** PyMuPDF
- **DOCX Parsing:** python-docx
- **Report Export:** browser-native print / PDF flow

## Setup

### 1. Create and activate a virtual environment

```powershell
python -m venv .venv
.venv\Scripts\activate
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

If job URL fetching fails because `requests` is not installed in your environment, run:

```powershell
pip install requests
```

### 3. Add your Groq API key

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=openai/gpt-oss-120b
GROQ_FALLBACK_MODEL=qwen/qwen3.6-27b
FLASK_SECRET_KEY=replace_with_a_long_random_secret
```

Optional admin seed values for first-time database setup:

```env
SKILLBRIDGE_ADMIN_EMAIL=admin@example.com
SKILLBRIDGE_ADMIN_PASSWORD=StrongAdminPassword123
```

### 4. Run the app

```powershell
python run.py
```

Open:

```text
http://localhost:5000
```

## Authentication Notes

Protected workflows require login:

- career analysis
- assessments
- adaptive roadmap
- AI chat
- mock interview
- dashboards

Users only see their own stored records.

Admins can view global activity and drill into user-level records.

## Admin Seeding Behavior

On first launch, the app creates a default admin account if one does not already exist in the database.

Important:

- `SKILLBRIDGE_ADMIN_EMAIL` and `SKILLBRIDGE_ADMIN_PASSWORD` affect the **initial seed**
- if `skillbridge.db` already exists, changing those values does **not** automatically reset the stored admin password

If you need a clean reseed:

1. stop the app
2. back up or remove `skillbridge.db`
3. update admin env values
4. start the app again

## Database

Runtime data is stored in:

```text
skillbridge.db
```

Current tables:

- `users`
- `analyses`
- `assessments`
- `chat_logs`
- `interviews`

## API Overview

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### User

- `GET /api/user/dashboard`

### Admin

- `GET /api/admin/dashboard`
- `GET /api/admin/users/<id>`

### Analysis / AI

- `POST /api/analyse`
- `POST /api/fetch-job-url`
- `POST /api/assessment/start`
- `POST /api/assessment/evaluate`
- `POST /api/adaptive-roadmap`
- `POST /api/chat`
- `POST /api/interview`
- `POST /api/interview/feedback`

## Report Export

The report export includes:

- a custom front page styled like a project-report cover
- match and readiness summary
- strengths and gaps
- next steps
- salary insights
- recommended courses
- roadmap
- CV advice

The export uses the browser’s print / save-as-PDF flow.

## Known Notes

- heavily formatted CV PDFs may parse imperfectly
- job URL fetching depends on the target site allowing automated access
- LinkedIn may partially block or limit fetched content
- Groq API rate limits and key validity affect all AI features
- the database is local SQLite; for production, move to PostgreSQL or similar

## Local Development Tips

Restart the app after backend changes:

```powershell
python run.py
```

If an old Python server is hanging around:

```powershell
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
```

## Recommended Next Improvements

- password reset flow
- user profile edit page
- admin password change flow from UI
- richer report templates
- analysis comparison view
- production database migration
- role-based analytics charts in admin dashboard

## Author
Nitesh B

Built for the SkillBridge AI project.
