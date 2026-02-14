# RentShield

**AI-Powered UK Renters' Rights Navigator**

RentShield helps tenants and landlords understand their rights under the UK Renters' Rights Act 2025 (effective May 1, 2026). It provides AI legal guidance, notice analysis, evidence management, dispute assessment, secure messaging, and tenant engagement tools.

Built with FastAPI, MongoDB, MiniMax AI, and vanilla JavaScript.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Architecture](#architecture)
- [Security](#security)
- [Testing](#testing)
- [Environment Variables](#environment-variables)
- [Contributing](#contributing)
- [Support](#support)

---

## Features

### AI-Powered Legal Tools

- **AI Legal Guidance** — RAG-powered chat with source-cited responses from verified UK housing law
- **Emergency Detection** — Identifies critical situations (illegal evictions, utility cuts, threats)
- **Notice Checker** — Analyzes landlord notices for legal validity (Section 8, Section 13)
- **Notice Calculator** — Date-based validity checker for Section 21/Section 8/Section 13 notices
- **AI Scenario Simulator** — "What would happen if..." step-by-step legal outcome predictions
- **Text-to-Speech** — Audio output for urgent guidance
- **Confidence Scoring** — High/medium/low confidence based on knowledge base match quality
- **Source Citations** — Every response links to legislation.gov.uk sources

### Multi-Role System

- **Admin** — Create and manage landlord accounts, view platform analytics
- **Landlord** — Manage tenants, assign tasks, create perks, handle maintenance, track compliance
- **Tenant** — Chat with AI, manage evidence, journal, earn rewards, upload evidence, claim perks

### Tenant Tools

- **Evidence Locker** — Upload and categorize photos, documents for legal disputes (magic byte validation)
- **Document Vault** — Version-controlled storage for 14 document types with full version chains
- **Dispute Timeline** — Chronological event log for tribunal preparation
- **Case Strength Assessor** — Scores dispute readiness across 5 dimensions with recommendations
- **Legal Letter Generator** — AI-generated formal letters (repair requests, complaints, deposit demands)
- **Tenancy Agreement Analyzer** — Flag illegal clauses and unfair terms
- **Deposit Protection Checker** — Verify deposit protection with official schemes
- **Maintenance Requests** — Track repairs with Awaab's Law compliance deadlines
- **Rent Comparator** — Compare rent against ONS regional averages for tribunal challenges
- **Deadline Tracker** — Auto-populated deadlines from maintenance, compliance, and notices
- **Export Case File** — Full case bundle as JSON for solicitors/tribunals
- **Emergency Panic Button** — One-tap crisis response with auto evidence capture and legal guidance

### Communication

- **Secure Messaging** — Threaded landlord-tenant messaging with audit trail and read receipts
- **In-App Notifications** — Bell icon with real-time notification system
- **Local Authority Lookup** — Postcode-based council housing team finder
- **National Helplines** — Curated directory of housing helplines

### Landlord Tools

- **Reputation Score** — Weighted score from compliance (40%), maintenance (35%), tasks (25%)
- **Compliance Dashboard** — Track gas safety, EICR, EPC, and other legal requirements
- **Compliance Reminders** — Automated notifications for certificate renewals (9 types)
- **Tenant Management** — Create accounts, assign tasks, create perks

### Engagement

- **Wellbeing Journal** — Mood tracking with AI-guided reflections and streak tracking
- **Rewards System** — Points, levels (Newcomer to Housing Hero), and badges
- **Interactive Rights Quiz** — 12 scenario-based questions earning points for correct answers
- **Task System** — Landlord assigns tasks, tenant submits proof photos, earns points
- **Perks** — Landlords create incentives tenants can claim with points

### Compliance & Privacy

- **GDPR Compliance** — Data export, account deletion (Right to Erasure), privacy policy
- **Knowledge Base** — Curated articles with source attribution and verification dates
- **Evidence Guide** — AI-powered guidance on collecting evidence for specific issues
- **Multi-Language Support** — English, Polish, Romanian, Bengali, Urdu, Arabic (with RTL)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, Uvicorn |
| Database | MongoDB 7 (PyMongo) |
| AI/LLM | MiniMax API (chat + TTS) |
| Frontend | Vanilla HTML/CSS/JavaScript (SPA, PWA) |
| Auth | Bcrypt + token-based sessions with account lockout |
| Security | CSP, SRI, rate limiting, magic byte validation, path traversal protection |
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

# Set admin password (optional — random one generated if not set)
export ADMIN_PASSWORD=admin123

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
ADMIN_PASSWORD=admin123 python seed_db.py

# Start the server
RELOAD=true python app.py
```

Open <http://localhost:8000> in your browser.

### Default Login

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@rentshield.co.uk` | Value of `ADMIN_PASSWORD` env var |

> Set `ADMIN_PASSWORD` before seeding. If not set, a random password is generated and printed to the console (password change required on first login).

---

## Project Structure

```
rentShield/
├── config/                     # Configuration management
│   └── settings.py             # Pydantic settings (env vars)
├── database/                   # MongoDB connection layer
│   └── connection.py           # Connection pooling, collection accessors
├── models/                     # Pydantic request/response schemas
│   ├── schemas.py              # Chat, notice, TTS, wellbeing, rewards
│   └── users.py                # Auth, tasks, perks models
├── routes/                     # API route handlers (35 modules)
│   ├── admin_analytics.py      # Platform-wide analytics (admin)
│   ├── agreement.py            # Tenancy agreement analyzer
│   ├── analytics.py            # Usage analytics
│   ├── case_export.py          # Full case file export
│   ├── chat.py                 # RAG-powered legal chat
│   ├── compliance.py           # Compliance tracking
│   ├── dashboard.py            # Role-specific dashboards
│   ├── deadline_tracker.py     # Auto-populated deadline tracking
│   ├── deposit.py              # Deposit protection checker
│   ├── dispute_assessor.py     # Case strength scoring
│   ├── document_vault.py       # Versioned document storage
│   ├── evidence.py             # Evidence locker (file uploads)
│   ├── evidence_guide.py       # AI evidence collection guidance
│   ├── gdpr.py                 # GDPR (export, delete, privacy)
│   ├── knowledge.py            # Knowledge base articles
│   ├── letters.py              # AI legal letter generator
│   ├── local_authority.py      # Council lookup by postcode
│   ├── maintenance.py          # Maintenance requests (Awaab's Law)
│   ├── messaging.py            # Secure landlord-tenant messaging
│   ├── notice.py               # Notice validity checker
│   ├── notice_calculator.py    # Notice date calculator
│   ├── notifications.py        # In-app notification system
│   ├── panic_button.py         # Emergency response with evidence capture
│   ├── perks.py                # Tenant perk system
│   ├── quiz.py                 # Interactive rights quiz
│   ├── reminders.py            # Compliance certificate reminders
│   ├── rent_comparator.py      # Regional rent comparison
│   ├── reputation.py           # Landlord reputation scoring
│   ├── rewards.py              # Points and badges
│   ├── scenario_simulator.py   # AI "what if" scenario simulator
│   ├── tasks.py                # Landlord task assignments
│   ├── timeline.py             # Dispute timeline
│   ├── tts.py                  # Text-to-speech
│   ├── users.py                # Auth and user management
│   └── wellbeing.py            # Journaling with mood tracking
├── services/                   # Business logic
│   ├── ai_service.py           # MiniMax LLM/TTS integration
│   └── conversation_service.py # Chat history and analytics
├── utils/                      # Shared utilities
│   ├── auth.py                 # Token auth, password hashing, RBAC, lockout
│   ├── issue_detection.py      # Keyword-based urgency detection
│   ├── rag.py                  # RAG context retrieval with source citations
│   └── verify_sources.py       # Legislation URL health checker
├── data/
│   ├── legal_knowledge.json    # Legal knowledge base (source-attributed)
│   ├── community_knowledge.json# Community articles
│   └── compliance_requirements.json # Compliance requirements
├── static/                     # Frontend (SPA / PWA)
│   ├── index.html              # App shell with SRI hashes
│   ├── app.js                  # Application logic (~6500 lines)
│   ├── styles.css              # Styles
│   ├── sw.js                   # Service worker (offline support)
│   ├── manifest.json           # PWA manifest
│   └── i18n/                   # Translation files (6 languages)
├── tests/                      # Test suite (109 tests)
│   ├── conftest.py             # Shared fixtures
│   ├── test_auth.py            # Auth unit tests
│   ├── test_integration.py     # Integration tests (19 tests)
│   ├── test_issue_detection.py # Issue detection tests
│   ├── test_maintenance.py     # Maintenance deadline tests
│   ├── test_rag.py             # RAG pipeline tests
│   └── test_schemas.py         # Schema validation tests
├── app.py                      # FastAPI entry point (107 routes)
├── seed_db.py                  # Database initialization
├── entrypoint.sh               # Docker startup script
├── Dockerfile                  # Container image
├── docker-compose.yml          # Multi-container orchestration
├── requirements.txt            # Python dependencies
└── .env.example                # Environment template
```

---

## API Reference

All endpoints are prefixed with `/api/`. Authenticated endpoints require `Authorization: Bearer <token>` header.

### Auth
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login (returns token) | No |
| POST | `/api/auth/logout` | Revoke token (server-side) | Yes |
| POST | `/api/auth/change-password` | Change password | Yes |
| POST | `/api/auth/request-reset` | Generate reset token | Yes (admin/landlord) |
| POST | `/api/auth/reset-password` | Reset with token | No |

### Users
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/users/me` | Current user profile | Yes |
| POST | `/api/admin/landlords` | Create landlord | Admin |
| GET | `/api/admin/landlords` | List landlords | Admin |
| DELETE | `/api/admin/landlords/{id}` | Delete landlord (cascades) | Admin |
| POST | `/api/landlord/tenants` | Create tenant | Landlord |
| GET | `/api/landlord/tenants` | List tenants | Landlord |
| DELETE | `/api/landlord/tenants/{id}` | Delete tenant | Landlord |

### AI Features
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/chat` | AI legal guidance (RAG + sources) | No |
| POST | `/api/notice/check` | Analyze notice validity | No |
| POST | `/api/tts` | Text-to-speech | No |
| POST | `/api/scenarios/simulate` | AI scenario simulation | Yes |
| GET | `/api/scenarios/templates` | Pre-built scenario templates | Yes |
| POST | `/api/evidence-guide` | AI evidence collection guidance | Yes |

### Tenant Tools
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/evidence` | Upload evidence file | Yes |
| GET | `/api/evidence` | List evidence | Yes |
| DELETE | `/api/evidence/{id}` | Delete evidence | Yes |
| POST | `/api/timeline` | Log timeline event | Yes |
| GET | `/api/timeline` | Get timeline | Yes |
| POST | `/api/letters` | Generate legal letter | Yes |
| POST | `/api/agreement` | Analyze tenancy agreement | No |
| POST | `/api/deposit` | Check deposit protection | No |
| POST | `/api/maintenance` | Submit maintenance request | Yes |
| GET | `/api/maintenance` | List maintenance requests | Yes |
| GET | `/api/dispute-assessor` | Case strength assessment | Yes (tenant) |
| GET | `/api/case-export` | Export full case bundle | Yes |
| GET | `/api/deadlines` | Auto-populated deadline tracker | Yes |

### Document Vault
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/vault` | Create document (auto-versions) | Yes |
| GET | `/api/vault` | List documents (latest versions) | Yes |
| GET | `/api/vault/types` | List document types | Yes |
| GET | `/api/vault/versions/{chain_id}` | Version history | Yes |
| DELETE | `/api/vault/{id}` | Delete document version | Yes |

### Messaging
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/messages` | Send message | Yes |
| GET | `/api/messages/threads` | List message threads | Yes |
| GET | `/api/messages/threads/{id}` | Get thread (marks read) | Yes |
| GET | `/api/messages/unread-count` | Unread message count | Yes |

### Rent Comparator
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/rent-comparator/regions` | List UK regions | Yes |
| POST | `/api/rent-comparator/compare` | Compare rent vs market | Yes |

### Quiz
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/quiz/questions` | Get quiz questions | Yes |
| POST | `/api/quiz/answer` | Submit answer (+10 pts) | Yes |
| GET | `/api/quiz/progress` | Quiz progress stats | Yes |

### Emergency
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/emergency/types` | List emergency types | Yes (tenant) |
| POST | `/api/emergency/activate` | Activate panic button | Yes (tenant) |

### Landlord Features
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/reputation/{landlord_id}` | Landlord reputation score | Yes |
| GET | `/api/reputation/my/score` | Own reputation score | Landlord |
| POST | `/api/reminders` | Create compliance reminder | Landlord |
| GET | `/api/reminders` | List reminders | Landlord |
| DELETE | `/api/reminders/{id}` | Delete reminder | Landlord |
| GET | `/api/notice-calculator` | Notice date calculator | Yes |

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

### GDPR
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/gdpr/export` | Export all user data | Yes |
| DELETE | `/api/gdpr/account` | Delete account (Right to Erasure) | Yes |
| GET | `/api/gdpr/privacy-policy` | Privacy policy | No |

### Other
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/dashboard` | Role-specific dashboard | Yes |
| GET | `/api/notifications` | List notifications | Yes |
| POST | `/api/notifications/{id}/read` | Mark notification read | Yes |
| GET | `/api/knowledge` | Knowledge base articles | No |
| GET | `/api/local-authority/{postcode}` | Council lookup | Yes |
| GET | `/health` | Service health check | No |

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
    ├─► Source Attribution (legislation URLs + confidence scoring)
    │
    ├─► Conversation History (last 6 messages)
    │
    ├─► MiniMax LLM (prompt + legal context + history)
    │
    └─► Response (guidance + sources + confidence + disclaimer + optional TTS)
```

### Database Collections

| Collection | Purpose | Key Indexes |
|-----------|---------|-------------|
| `legal_knowledge` | Legal documents with source URLs | Compound text index (weighted) |
| `conversations` | Chat history | session_id, user_id, created_at |
| `analytics` | Event tracking | user_id, timestamp |
| `users` | All user accounts | email (unique), user_id (unique), role |
| `wellbeing_journal` | Mood entries | user_id, created_at |
| `rewards` | Points and badges | user_id |
| `tasks` | Assigned tasks | task_id (unique), landlord_id, tenant_id |
| `perks` | Landlord perks | perk_id (unique), landlord_id |
| `evidence` | Uploaded files | evidence_id (unique), user_id |
| `maintenance` | Repair requests | tenant_id, landlord_id, status |
| `timeline` | Dispute events | user_id, created_at |
| `notifications` | In-app notifications | notification_id (unique), recipient_id |
| `compliance` | Certificate tracking | landlord_id |
| `messages` | Secure messaging | thread_id, sender_id, recipient_id |
| `document_vault` | Versioned documents | document_id, user_id, version_chain_id |
| `quiz_attempts` | Quiz answers | user_id, question_id |
| `emergencies` | Emergency reports | user_id |
| `scenario_simulations` | AI scenario results | user_id |
| `compliance_reminders` | Certificate reminders | user_id, reminder_date |

### Auth Flow

1. User logs in with email + password → receives a 24-hour token
2. Account lockout after 5 failed attempts (15-minute cooldown)
3. Token sent via `Authorization: Bearer <token>` header on each request
4. `require_role()` validates token and checks role permissions
5. Server-side token revocation on logout
6. `must_change_password` flag enforced for auto-generated passwords

---

## Security

- **XSS Prevention** — `escapeHtml()` on all user content, `textContent` instead of `innerHTML` for user data
- **Content Security Policy** — Strict CSP headers restricting script sources
- **Subresource Integrity** — SRI hashes on all CDN scripts (jsPDF, Chart.js)
- **Rate Limiting** — 100 req/min global, 10/min on chat, 5/min on AI endpoints
- **Account Lockout** — 5 failed logins → 15-minute lockout
- **Magic Byte Validation** — File upload headers verified against content type
- **Path Traversal Protection** — `os.path.realpath()` validation on file operations
- **CORS** — Default same-origin only (configurable via `CORS_ORIGINS`)
- **Security Headers** — X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- **Server-Side Logout** — Token revocation on logout (not just client-side)
- **GDPR Compliance** — Full data export, account deletion with file cleanup

---

## Testing

```bash
# Run all 109 tests
python3 -m pytest tests/ -v

# Run specific test file
python3 -m pytest tests/test_integration.py -v

# Verify legislation source URLs are reachable
python -m utils.verify_sources
```

### Test Coverage

| Test File | Tests | Coverage |
|-----------|-------|---------|
| `test_auth.py` | 18 | Password hashing, tokens, RBAC |
| `test_integration.py` | 19 | Login/logout, dashboard, GDPR, evidence, security headers |
| `test_issue_detection.py` | 16 | Urgency levels, false positive prevention |
| `test_maintenance.py` | 7 | Awaab's Law deadline calculations |
| `test_rag.py` | 10 | RAG context retrieval, source attribution |
| `test_schemas.py` | 14 | Pydantic schema validation |

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
| `ADMIN_PASSWORD` | No | *(random)* | Admin password (random if not set) |
| `CORS_ORIGINS` | No | *(empty)* | Allowed CORS origins (comma-separated) |
| `FORCE_HTTPS` | No | `false` | Redirect HTTP to HTTPS |
| `RELOAD` | No | `false` | Enable uvicorn auto-reload |

> When running with Docker Compose, `MONGODB_URI` is automatically set to `mongodb://mongodb:27017/rentshield`.

---

## Contributing

1. Follow the existing code style (PEP 8 for Python, `var`/`function` for JS)
2. Add type hints and docstrings to all Python functions
3. Use `escapeHtml()` for all user-provided content in frontend
4. Wrap database operations in try-catch with proper error messages
5. Bump `CACHE_NAME` in `static/sw.js` after any frontend change
6. Run `python3 -m pytest tests/ -v` and ensure all 109 tests pass
7. Add `.limit()` to all MongoDB queries to prevent unbounded results

---

## Support

For real housing emergencies, contact:

- **Shelter Helpline**: 0808 800 4444
- **Citizens Advice**: 0800 144 8848
- **Police (non-emergency)**: 101
- **999** for immediate danger

---

Built for the Cursor Northampton Hackathon 2026.
