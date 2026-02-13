# RentShield

**AI-Powered UK Renters' Rights Navigator**

RentShield helps tenants and landlords understand their rights under the UK Renters' Rights Act 2025 (effective May 1, 2026). It provides AI legal guidance, notice analysis, evidence management, and tenant engagement tools.

Built with FastAPI, MongoDB, MiniMax AI, and vanilla JavaScript.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Testing](#testing)
- [Environment Variables](#environment-variables)
- [Contributing](#contributing)
- [Support](#support)

---

## Features

### Core

- **AI Legal Guidance** — RAG-powered chat with legal context from UK housing law
- **Emergency Detection** — Identifies critical situations (illegal evictions, utility cuts, threats)
- **Notice Checker** — Analyzes landlord notices for legal validity (Section 21, Section 8, rent increases)
- **Text-to-Speech** — Audio output for urgent guidance

### Multi-Role System

- **Admin** — Create and manage landlord accounts
- **Landlord** — Manage tenants, assign tasks, create perks, handle maintenance
- **Tenant** — Chat with AI, journal, earn rewards, upload evidence, claim perks

### Tenant Tools

- **Evidence Locker** — Upload and categorize photos, documents for legal disputes
- **Dispute Timeline** — Chronological event log for tribunal preparation
- **Legal Letter Generator** — AI-generated formal letters (repair requests, complaints, deposit demands)
- **Tenancy Agreement Analyzer** — Flag illegal clauses and unfair terms
- **Deposit Protection Checker** — Verify deposit protection with official schemes
- **Maintenance Requests** — Track repairs with Awaab's Law compliance deadlines

### Engagement

- **Wellbeing Journal** — Mood tracking with AI-guided reflections and streak tracking
- **Rewards System** — Points, levels (Newcomer to Housing Hero), and badges
- **Task System** — Landlord assigns tasks, tenant submits proof photos, earns points
- **Perks** — Landlords create incentives tenants can claim with points

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, Uvicorn |
| Database | MongoDB 7 (PyMongo) |
| AI/LLM | MiniMax API (chat + TTS) |
| Frontend | Vanilla HTML/CSS/JavaScript (SPA) |
| Auth | Bcrypt + token-based sessions |
| Containerization | Docker, Docker Compose |

---

## Getting Started

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone <repo-url>
cd rentShield

# Create your environment file
cp .env.example .env
# Edit .env and add your MiniMax API key

# Start everything
docker compose up --build
```

This starts MongoDB and the app, seeds the database, and serves the UI at <http://localhost:8000>.

### Option 2: Local Development

**Prerequisites:** Python 3.11+, MongoDB running on localhost:27017

```bash
# Install dependencies
pip install -r requirements.txt

# Create your environment file
cp .env.example .env
# Edit .env and add your MiniMax API key

# Seed the database
python seed_db.py

# Start the server (with auto-reload)
python app.py
```

Open <http://localhost:8000> in your browser.

### Default Login

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@rentshield.co.uk` | `admin123` |

> Change the admin password after first login. Set custom credentials via `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before seeding.

---

## Project Structure

```
rentShield/
├── config/                  # Configuration management
│   └── settings.py          # Pydantic settings (env vars)
├── database/                # MongoDB connection layer
│   └── connection.py        # Connection pooling, collection accessors
├── models/                  # Pydantic request/response schemas
│   ├── schemas.py           # Chat, notice, TTS, wellbeing, rewards
│   └── users.py             # Auth, tasks, perks models
├── routes/                  # API route handlers
│   ├── agreement.py         # Tenancy agreement analyzer
│   ├── analytics.py         # Analytics summary
│   ├── chat.py              # RAG-powered legal chat
│   ├── deposit.py           # Deposit protection checker
│   ├── evidence.py          # Evidence locker (file uploads)
│   ├── letters.py           # AI legal letter generator
│   ├── maintenance.py       # Maintenance requests (Awaab's Law)
│   ├── notice.py            # Notice validity checker
│   ├── perks.py             # Tenant perk system
│   ├── rewards.py           # Points and badges
│   ├── tasks.py             # Landlord task assignments
│   ├── timeline.py          # Dispute timeline
│   ├── tts.py               # Text-to-speech
│   ├── users.py             # Auth and user management
│   └── wellbeing.py         # Journaling with mood tracking
├── services/                # Business logic
│   ├── ai_service.py        # MiniMax LLM/TTS integration
│   └── conversation_service.py  # Chat history and analytics
├── utils/                   # Shared utilities
│   ├── auth.py              # Token auth, password hashing, RBAC
│   ├── issue_detection.py   # Keyword-based urgency detection
│   └── rag.py               # RAG context retrieval (MongoDB text search)
├── data/
│   └── legal_knowledge.json # Legal knowledge base (10 documents)
├── static/                  # Frontend (SPA)
│   ├── index.html           # App shell
│   ├── app.js               # Application logic
│   ├── styles.css           # Styles
│   ├── sw.js                # Service worker (PWA)
│   └── manifest.json        # PWA manifest
├── tests/
│   └── test_auth.py         # Unit tests
├── app.py                   # FastAPI entry point
├── seed_db.py               # Database initialization
├── entrypoint.sh            # Docker startup script
├── Dockerfile               # Container image
├── docker-compose.yml       # Multi-container orchestration
├── requirements.txt         # Python dependencies
└── .env.example             # Environment template
```

---

## API Reference

All endpoints are prefixed with `/api/`. Authenticated endpoints require `Authorization: Bearer <token>` header.

### Auth
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login (returns token) | No |
| POST | `/api/auth/logout` | Revoke token | Yes |
| POST | `/api/auth/change-password` | Change password | Yes |
| POST | `/api/auth/request-reset` | Generate reset token | Yes (admin/landlord) |
| POST | `/api/auth/reset-password` | Reset with token | No |

### Users
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/users/me` | Current user profile | Yes |
| POST | `/api/admin/landlords` | Create landlord | Admin |
| GET | `/api/admin/landlords` | List landlords | Admin |
| DELETE | `/api/admin/landlords/{id}` | Delete landlord + tenants | Admin |
| POST | `/api/landlord/tenants` | Create tenant | Landlord |
| GET | `/api/landlord/tenants` | List tenants | Landlord |
| DELETE | `/api/landlord/tenants/{id}` | Delete tenant | Landlord |

### Core Features
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/chat` | AI legal guidance (RAG) | No |
| POST | `/api/notice/check` | Analyze notice validity | No |
| POST | `/api/tts` | Text-to-speech | No |
| GET | `/api/analytics/summary` | Aggregated statistics | No |

### Tenant Tools
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/evidence` | Upload evidence file | Yes |
| GET | `/api/evidence` | List evidence | Yes |
| POST | `/api/timeline` | Log timeline event | Yes |
| GET | `/api/timeline` | Get timeline | Yes |
| POST | `/api/letters` | Generate legal letter | Yes |
| POST | `/api/agreement` | Analyze tenancy agreement | No |
| POST | `/api/deposit` | Check deposit protection | No |
| POST | `/api/maintenance` | Submit maintenance request | Yes |
| GET | `/api/maintenance` | List maintenance requests | Yes |

### Engagement
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/wellbeing` | Create journal entry | No |
| GET | `/api/wellbeing` | Get journal entries | No |
| POST | `/api/rewards` | Log reward action | No |
| GET | `/api/rewards` | Get rewards profile | No |
| POST | `/api/tasks` | Create task | Landlord |
| GET | `/api/tasks` | List tasks | Yes |
| POST | `/api/perks` | Create perk | Landlord |
| GET | `/api/perks` | List perks | Yes |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Database and service status |

---

## Architecture

### RAG Pipeline

```
User Message
    │
    ├─► Issue Detection (keyword matching → urgency level)
    │
    ├─► MongoDB Text Search (weighted: keywords 10x, title 5x, subtopic 3x, content 1x)
    │
    ├─► Conversation History (last 6 messages)
    │
    ├─► MiniMax LLM (prompt + legal context + history)
    │
    └─► Response (guidance + optional TTS for critical issues)
```

### Database Collections

| Collection | Purpose | Key Indexes |
|-----------|---------|-------------|
| `legal_knowledge` | Legal documents | Compound text index (weighted) |
| `conversations` | Chat history | session_id, created_at |
| `analytics` | Event tracking | timestamp, issue_type |
| `users` | All user accounts | email (unique), user_id (unique), role |
| `wellbeing_journal` | Mood entries | session_id, created_at |
| `rewards` | Points and badges | session_id (unique) |
| `tasks` | Assigned tasks | task_id (unique), landlord_id, tenant_id |
| `perks` | Landlord perks | perk_id (unique), landlord_id |
| `evidence` | Uploaded files | evidence_id (unique), user_id |
| `maintenance` | Repair requests | user_id, status |
| `timeline` | Dispute events | user_id, created_at |

### Auth Flow

1. User logs in with email + password → receives a 24-hour token
2. Token sent via `Authorization: Bearer <token>` header on each request
3. `require_role()` validates token and checks role permissions
4. Tokens revoked on logout or password change

---

## Testing

```bash
# Run unit tests
pytest tests/ -v

# Test the health endpoint
curl http://localhost:8000/health

# Test login
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@rentshield.co.uk","password":"admin123"}'

# Test chat (no auth required)
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"My landlord changed the locks","user_type":"tenant"}'
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MINIMAX_API_KEY` | Yes | — | MiniMax API key |
| `MINIMAX_API_BASE` | No | `https://api.minimax.io` | MiniMax API base URL |
| `MINIMAX_GROUP_ID` | No | — | MiniMax Group ID (for TTS) |
| `MONGODB_URI` | Yes | — | MongoDB connection string |
| `APP_HOST` | No | `0.0.0.0` | Server host |
| `APP_PORT` | No | `8000` | Server port |
| `ADMIN_EMAIL` | No | `admin@rentshield.co.uk` | Default admin email |
| `ADMIN_PASSWORD` | No | `ChangeMe123` | Default admin password |
| `CORS_ORIGINS` | No | `*` | Allowed CORS origins (comma-separated) |
| `FORCE_HTTPS` | No | `false` | Redirect HTTP to HTTPS |

> When running with Docker Compose, `MONGODB_URI` is automatically set to `mongodb://mongodb:27017/rentshield`.

---

## Contributing

1. Follow the existing code style (PEP 8 for Python, `var`/`function` for JS)
2. Add type hints and docstrings to all Python functions
3. Comment JS functions with JSDoc
4. Wrap database operations in try-catch with proper error messages
5. Bump `CACHE_NAME` in `static/sw.js` after any frontend change
6. Test your changes before submitting

---

## Support

For real housing emergencies, contact:

- **Shelter Helpline**: 0808 800 4444
- **Citizens Advice**: 0800 144 8848
- **999** for immediate danger

---

Built for the Cursor Northampton Hackathon.
