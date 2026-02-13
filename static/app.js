/* ==========================================================================
   RentShield - Main Application JavaScript
   AI-Powered UK Renters' Rights Navigator
   ========================================================================== */


/* --------------------------------------------------------------------------
   1. Application State
   -------------------------------------------------------------------------- */

/** Current selected role on the auth screen */
let selectedRole = 'tenant';

/** Auth token from login (persisted in localStorage) */
let authToken = localStorage.getItem('rs_t') || '';

/** Current user object: { id, role, name } */
let currentUser = JSON.parse(localStorage.getItem('rs_u') || 'null');

/** Current chat session ID */
let sessionId = null;

/** Number of messages sent in current session */
let messageCount = 0;

/** Number of critical/urgent responses in current session */
let criticalCount = 0;

/** Tracks detected issue types and their counts: { issue_type: count } */
let issueTracker = {};

/** Currently selected mood (1-5) on the wellbeing journal */
let selectedMood = 0;

/** Reference to the currently playing audio element */
let currentAudio = null;


/* --------------------------------------------------------------------------
   2. Constants
   -------------------------------------------------------------------------- */

/** Human-readable mood labels mapped by score */
const MOOD_LABELS = {
    1: 'Very low',
    2: 'Low',
    3: 'Okay',
    4: 'Good',
    5: 'Great'
};

/** Mood bar colors for the mood chart, mapped by score */
const MOOD_COLORS = {
    1: '#C0392B',
    2: '#D4903A',
    3: '#8C95A6',
    4: '#2B8A7E',
    5: '#27864A'
};

/** Reward level thresholds: points needed, level name, and next level target */
const REWARD_LEVELS = [
    { points: 0,   name: 'Newcomer',           nextAt: 50 },
    { points: 50,  name: 'Informed Tenant',     nextAt: 150 },
    { points: 150, name: 'Rights Advocate',     nextAt: 300 },
    { points: 300, name: 'Community Champion',  nextAt: 500 },
    { points: 500, name: 'Housing Hero',        nextAt: null }
];

/** All available badges for the rewards page */
const ALL_BADGES = [
    { id: 'first_question',   name: 'First Step',        description: 'Ask first question' },
    { id: 'journal_starter',  name: 'Journal Starter',   description: 'First entry' },
    { id: 'knowledge_seeker', name: 'Knowledge Seeker',  description: '5 rights learned' },
    { id: 'wellbeing_warrior', name: 'Wellbeing Warrior', description: '7 entries' },
    { id: 'notice_expert',    name: 'Notice Expert',     description: '3 notices' },
    { id: 'century_club',     name: '100 Club',          description: '100 points' }
];


/* --------------------------------------------------------------------------
   3. Utility Helpers
   -------------------------------------------------------------------------- */

/**
 * Extract a readable error message from an API error response.
 * Handles both string details and Pydantic validation error arrays.
 * @param {Object} errorData - The parsed JSON error response
 * @param {string} fallback - Default message if extraction fails
 * @returns {string} Human-readable error message
 */
function getErrorMessage(errorData, fallback) {
    var detail = errorData.detail;

    /* String detail from HTTPException */
    if (typeof detail === 'string') {
        return detail;
    }

    /* Array of validation errors from Pydantic */
    if (Array.isArray(detail)) {
        return detail.map(function(err) {
            return err.msg || String(err);
        }).join('. ');
    }

    return fallback || 'An error occurred.';
}

/**
 * Safely extract an error message from a failed HTTP response.
 * Reads body as text first, then tries JSON parsing. Always includes status code.
 * @param {Response} response - The fetch Response object
 * @param {string} fallback - Default message if parsing fails
 * @returns {Promise<string>} Human-readable error message
 */
async function getResponseError(response, fallback) {
    try {
        var text = await response.text();
        var data = JSON.parse(text);
        return getErrorMessage(data, fallback + ' (Status: ' + response.status + ')');
    } catch (e) {
        return fallback + ' (Status: ' + response.status + ')';
    }
}

/**
 * Build standard headers object for authenticated API requests.
 * @returns {Object} Headers with Content-Type and Authorization
 */
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken
    };
}

/**
 * Convert basic markdown syntax to HTML for chat display.
 * Handles bold, newlines, and bullet points.
 * @param {string} text - Raw markdown text
 * @returns {string} HTML string
 */
function formatMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>')
        .replace(/^- /gm, '&bull; ');
}

/**
 * Strip markdown formatting from text for TTS consumption.
 * @param {string} text - Markdown text
 * @returns {string} Plain text suitable for speech
 */
function stripMarkdownForSpeech(text) {
    return text
        .replace(/#{1,6}\s?/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/- /g, ', ')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ', ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Render an issue tracker list as HTML.
 * Used by both updateIssues() and loadAnalytics() to avoid duplication.
 * @param {Object} issues - Map of { issue_type: count }
 * @returns {string} HTML string of issue items
 */
function renderIssueList(issues) {
    return Object.entries(issues)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) =>
            '<div class="s-issue">' +
                '<span>' + type.replace(/_/g, ' ') + '</span>' +
                '<span class="s-cnt">' + count + '</span>' +
            '</div>'
        ).join('');
}


/* --------------------------------------------------------------------------
   4. Authentication
   -------------------------------------------------------------------------- */

/**
 * Set the active role tab on the auth screen.
 * @param {string} role - One of 'tenant', 'landlord', 'admin'
 */
function pickRole(role) {
    selectedRole = role;
    var tabs = document.querySelectorAll('#a-tabs button');
    tabs.forEach(function(tab) { tab.className = ''; });
    var roleIndex = ['tenant', 'landlord', 'admin'].indexOf(role);
    tabs[roleIndex].className = 'on';
    updateRoleTabAria(role);
}

/**
 * Attempt to log in with the entered email and password.
 * On success, saves token and user to localStorage and boots the app.
 */
async function login() {
    var email = document.getElementById('a-email').value.trim();
    var password = document.getElementById('a-pw').value;
    var errorDisplay = document.getElementById('a-err');

    errorDisplay.textContent = '';

    if (!email || !password) {
        errorDisplay.textContent = 'Enter email and password.';
        return;
    }

    try {
        var response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Invalid credentials.');
            errorDisplay.textContent = errMsg;
            return;
        }

        var data = await response.json();

        /* Verify the returned role matches the selected tab */
        if (data.role !== selectedRole) {
            errorDisplay.textContent = 'This account is a ' + data.role + '. Switch the tab above.';
            return;
        }

        authToken = data.token;
        currentUser = { id: data.user_id, role: data.role, name: data.name };
        localStorage.setItem('rs_t', authToken);
        localStorage.setItem('rs_u', JSON.stringify(currentUser));
        boot();
    } catch (error) {
        errorDisplay.textContent = 'Connection error.';
    }
}

/**
 * Log out: clear state, remove stored credentials, show auth screen.
 */
function logout() {
    authToken = '';
    currentUser = null;
    localStorage.removeItem('rs_t');
    localStorage.removeItem('rs_u');
    document.getElementById('auth').style.display = 'flex';
    document.getElementById('auth').setAttribute('aria-hidden', 'false');
    document.getElementById('app').style.display = 'none';
    document.getElementById('app').setAttribute('aria-hidden', 'true');
    document.getElementById('a-email').value = '';
    document.getElementById('a-pw').value = '';
    document.getElementById('a-err').textContent = '';
}


/* --------------------------------------------------------------------------
   5. App Boot & Navigation
   -------------------------------------------------------------------------- */

/**
 * Boot the application after successful login.
 * Shows the app shell and initializes the correct role view.
 */
function boot() {
    document.getElementById('auth').style.display = 'none';
    document.getElementById('auth').setAttribute('aria-hidden', 'true');
    document.getElementById('app').style.display = 'flex';
    document.getElementById('app').setAttribute('aria-hidden', 'false');
    document.getElementById('h-name').textContent = currentUser.name;
    document.getElementById('h-av').textContent = currentUser.name.charAt(0).toUpperCase();

    if (currentUser.role === 'tenant') {
        initTenant();
    } else if (currentUser.role === 'landlord') {
        initLandlord();
    } else {
        initAdmin();
    }
}

/**
 * Build the sidebar navigation from an array of navigation items.
 * @param {Array} items - Array of { t: label, pg: pageId } or { sep: 1 } or { lbl: text }
 */
function setNav(items) {
    var nav = document.getElementById('nav');
    nav.innerHTML = items.map(function(item, index) {
        if (item.sep) return '<div class="n-sep"></div>';
        if (item.lbl) return '<div class="n-lbl">' + item.lbl + '</div>';
        var isFirst = items.findIndex(function(x) { return !x.sep && !x.lbl; });
        var activeClass = (index === isFirst) ? ' on' : '';
        return '<button class="n-btn' + activeClass + '" data-pg="' + item.pg + '" onclick="navigateTo(\'' + item.pg + '\')">' + item.t + '</button>';
    }).join('');
}

/**
 * Navigate to a page by its ID. Updates active nav button and loads page data.
 * @param {string} pageId - The page identifier (e.g., 'chat', 'notice', 'rewards')
 */
function navigateTo(pageId) {
    /* Deactivate all pages and nav buttons */
    document.querySelectorAll('.pg').forEach(function(page) { page.classList.remove('on'); });
    document.querySelectorAll('.n-btn').forEach(function(btn) { btn.classList.remove('on'); });

    /* Activate the target page */
    var pageElement = document.getElementById('pg-' + pageId);
    if (pageElement) pageElement.classList.add('on');

    /* Activate the matching nav button */
    var navButton = document.querySelector('.n-btn[data-pg="' + pageId + '"]');
    if (navButton) navButton.classList.add('on');

    /* Load page-specific data */
    if (pageId === 'wellbeing') loadWellbeingHistory();
    if (pageId === 'rewards') loadRewards();
    if (pageId === 'll-tenants' || pageId === 'll-tasks' || pageId === 'll-perks') loadLandlordPage(pageId);
    if (pageId === 't-tasks') loadTenantTasks();
    if (pageId === 'admin-ll') loadAdminLandlords();
    if (pageId === 'evidence') loadEvidence();
    if (pageId === 'timeline') loadTimeline();
    if (pageId === 'letters') loadLettersPage();
    if (pageId === 'agreement') loadAgreementPage();
    if (pageId === 'deposit') loadDepositPage();
    if (pageId === 'maintenance') loadMaintenancePage();
    if (pageId === 'll-maintenance') loadLandlordMaintenance();
}


/* --------------------------------------------------------------------------
   6. Shared HTML Templates (DRY)
   -------------------------------------------------------------------------- */

/**
 * Generate the chat page HTML. Used by both tenant and landlord views.
 * @param {string} heading - Welcome heading text
 * @param {string} description - Welcome description text
 * @param {Array} quickPrompts - Array of { label, text } for quick prompt buttons
 * @param {string} placeholder - Input placeholder text
 * @param {string} sidebarContent - Additional sidebar HTML
 * @returns {string} HTML string for the chat page
 */
function buildChatPageHtml(heading, description, quickPrompts, placeholder, sidebarContent) {
    var promptButtons = quickPrompts.map(function(qp) {
        return '<button class="qp" onclick="sendQuickPrompt(\'' +
            qp.text.replace(/'/g, "\\'") + '\')">' + qp.label + '</button>';
    }).join('');

    return '' +
        '<div class="chat-layout">' +
            '<div class="chat-main">' +
                '<div style="display:flex;justify-content:flex-end;padding:8px 20px 0;background:var(--white);border-bottom:1px solid var(--bg-secondary)">' +
                    '<button class="export-btn" onclick="exportChatPdf()" aria-label="Export chat as PDF">Export PDF</button>' +
                '</div>' +
                '<div class="chat-feed" id="feed">' +
                    '<div class="welcome" id="wel">' +
                        '<h2>' + heading + '</h2>' +
                        '<p>' + description + '</p>' +
                        '<div class="qp-wrap">' + promptButtons + '</div>' +
                    '</div>' +
                    '<div class="dots hidden" id="dots">' +
                        '<div class="dot-a"></div><div class="dot-a"></div><div class="dot-a"></div>' +
                    '</div>' +
                '</div>' +
                '<div class="chat-bar">' +
                    '<textarea class="chat-ta" id="mi" placeholder="' + placeholder + '" rows="1" ' +
                        'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendMessage()}" ' +
                        'oninput="this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight,100)+\'px\'"></textarea>' +
                    '<button class="send" id="sb" onclick="sendMessage()">&#8594;</button>' +
                '</div>' +
            '</div>' +
            '<aside class="side">' +
                '<div class="urg" id="ub"></div>' +
                '<div>' +
                    '<div class="s-hdr">Session</div>' +
                    '<div class="s-stats">' +
                        '<div class="s-stat"><div class="s-num" id="sq">0</div><div class="s-lbl">Queries</div></div>' +
                        '<div class="s-stat"><div class="s-num red" id="sc">0</div><div class="s-lbl">Urgent</div></div>' +
                    '</div>' +
                '</div>' +
                sidebarContent +
            '</aside>' +
        '</div>';
}

/**
 * Generate the notice checker page HTML. Used by both tenant and landlord views.
 * @param {string} description - Page description text
 * @returns {string} HTML string for the notice checker
 */
function buildNoticePageHtml(description) {
    return '' +
        '<div class="ps" style="max-width:640px;margin:0 auto;width:100%">' +
            '<h2 class="ph">Notice Checker</h2>' +
            '<p class="pp">' + description + '</p>' +
            '<textarea class="n-ta" id="nta" placeholder="Paste notice text here..." aria-label="Paste your landlord notice here"></textarea>' +
            '<div style="display:flex;gap:8px;align-items:center">' +
                '<button class="btn btn-p" id="nbtn" onclick="checkNotice()">Analyze notice</button>' +
                '<button class="export-btn" onclick="exportNoticePdf()" aria-label="Export notice analysis as PDF">Export PDF</button>' +
            '</div>' +
            '<div class="n-result" id="nres"><div class="n-body" id="ncon"></div></div>' +
        '</div>';
}


/* --------------------------------------------------------------------------
   7. Role Initialization (Tenant, Landlord, Admin)
   -------------------------------------------------------------------------- */

/** Initialize the tenant dashboard with all pages. */
function initTenant() {
    setNav([
        { lbl: 'Legal Tools' },
        { t: 'AI Chat', pg: 'chat' },
        { t: 'Notice Checker', pg: 'notice' },
        { t: 'Letter Generator', pg: 'letters' },
        { t: 'Agreement Analyzer', pg: 'agreement' },
        { t: 'Deposit Checker', pg: 'deposit' },
        { sep: 1 },
        { lbl: 'My Case' },
        { t: 'Evidence Locker', pg: 'evidence' },
        { t: 'Dispute Timeline', pg: 'timeline' },
        { t: 'Maintenance', pg: 'maintenance' },
        { sep: 1 },
        { lbl: 'Wellbeing' },
        { t: 'Journal', pg: 'wellbeing' },
        { t: 'Rewards', pg: 'rewards' },
        { sep: 1 },
        { lbl: 'Tasks' },
        { t: 'Tasks & Perks', pg: 't-tasks' }
    ]);

    var tenantQuickPrompts = [
        { label: 'My landlord says I must leave', text: 'My landlord says I must leave' },
        { label: 'Locks changed while I was out',  text: 'Locks changed while I was out' },
        { label: 'Rent being increased',            text: 'Rent being increased' },
        { label: 'Deposit not returned',            text: 'Deposit not returned' },
        { label: 'Mould and repairs ignored',       text: 'Mould and repairs ignored' }
    ];

    var tenantSidebar = '' +
        '<div>' +
            '<div class="s-hdr">Issues detected</div>' +
            '<div id="si"><div class="empty">No queries yet</div></div>' +
        '</div>' +
        '<div>' +
            '<div class="s-hdr">Emergency contacts</div>' +
            '<div class="s-contact"><div class="s-cn">Shelter Helpline</div><div class="s-cp">0808 800 4444</div><div class="s-ch">Mon-Fri, 8am-8pm</div></div>' +
            '<div class="s-contact"><div class="s-cn">Citizens Advice</div><div class="s-cp">0800 144 8848</div><div class="s-ch">Mon-Fri, 9am-5pm</div></div>' +
            '<div class="s-contact"><div class="s-cn">Police (non-emergency)</div><div class="s-cp">101</div><div class="s-ch">Illegal eviction reports</div></div>' +
        '</div>' +
        '<div class="s-disc">RentShield provides general legal information based on the Renters\' Rights Act 2025. Not a substitute for professional legal advice.</div>';

    var chatHtml = buildChatPageHtml(
        "What's happening with your home?",
        "Describe your situation and I'll provide specific legal guidance based on the Renters' Rights Act 2025.",
        tenantQuickPrompts,
        'Describe your situation...',
        tenantSidebar
    );

    var noticeHtml = buildNoticePageHtml(
        "Paste a notice from your landlord and I'll check its legal validity under the Renters' Rights Act 2025."
    );

    document.getElementById('pw').innerHTML =
        '<div class="pg on" id="pg-chat">' + chatHtml + '</div>' +
        '<div class="pg" id="pg-notice">' + noticeHtml + '</div>' +
        '<div class="pg" id="pg-wellbeing">' +
            '<div class="ps" style="max-width:560px;margin:0 auto;width:100%">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
                    '<h2 class="ph">Wellbeing Journal</h2>' +
                    '<button class="export-btn" onclick="exportWellbeingPdf()" aria-label="Export journal as PDF">Export PDF</button>' +
                '</div>' +
                '<p class="pp">Track your mood and receive AI-guided reflection prompts. Entries also serve as timestamped evidence.</p>' +
                '<p style="color:var(--text-secondary);font-size:13px;margin-bottom:10px;text-align:center">How are you feeling today?</p>' +
                '<div class="mood-row">' +
                    '<button class="mood-b" onclick="pickMood(1)" data-m="1">1</button>' +
                    '<button class="mood-b" onclick="pickMood(2)" data-m="2">2</button>' +
                    '<button class="mood-b" onclick="pickMood(3)" data-m="3">3</button>' +
                    '<button class="mood-b" onclick="pickMood(4)" data-m="4">4</button>' +
                    '<button class="mood-b" onclick="pickMood(5)" data-m="5">5</button>' +
                '</div>' +
                '<div class="mood-lbl" id="ml">Select 1 to 5</div>' +
                '<textarea class="j-ta" id="jta" placeholder="What\'s on your mind?"></textarea>' +
                '<button class="btn btn-p" id="jbtn" onclick="submitJournal()" disabled>Log entry</button>' +
                '<div class="card ai-out" id="ai-out" style="margin-top:18px">' +
                    '<h4>Guided prompt</h4><p id="ai-p"></p>' +
                    '<h4>Reflection</h4><p id="ai-r"></p>' +
                    '<div style="font-size:12px;color:var(--success);margin-top:4px" id="ai-pts"></div>' +
                '</div>' +
                '<div style="margin-top:20px">' +
                    '<div class="sec">Mood trend</div>' +
                    '<div class="mood-chart" id="mch"></div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div class="pg" id="pg-rewards">' +
            '<div class="ps" style="max-width:560px;margin:0 auto;width:100%">' +
                '<h2 class="ph">Rewards</h2>' +
                '<p class="pp">Earn points for learning your rights, journaling, and checking notices.</p>' +
                '<div class="lv-card">' +
                    '<div class="lv-name" id="rl">Newcomer</div>' +
                    '<div class="lv-pts" id="rp">0</div>' +
                    '<div class="lv-lbl">points earned</div>' +
                    '<div class="pbar"><div class="pfill" id="rb" style="width:0%"></div></div>' +
                    '<div class="nxt" id="rn">Next: Informed Tenant (50 pts)</div>' +
                '</div>' +
                '<div class="sec">Badges</div>' +
                '<div class="b-grid" id="rbg"></div>' +
                '<div style="margin-top:18px">' +
                    '<div class="sec">Vouchers</div>' +
                    '<div id="rv"><p class="empty">Earn 100 points for your first voucher.</p></div>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div class="pg" id="pg-t-tasks">' +
            '<div class="ps" id="ttb"><p class="empty" style="text-align:center;padding:40px">Loading...</p></div>' +
        '</div>' +

        /* Evidence Locker page */
        '<div class="pg" id="pg-evidence">' +
            '<div class="ps" id="evidence-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Dispute Timeline page */
        '<div class="pg" id="pg-timeline">' +
            '<div class="ps" id="timeline-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Letter Generator page */
        '<div class="pg" id="pg-letters">' +
            '<div class="ps" id="letters-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Agreement Analyzer page */
        '<div class="pg" id="pg-agreement">' +
            '<div class="ps" id="agreement-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Deposit Checker page */
        '<div class="pg" id="pg-deposit">' +
            '<div class="ps" id="deposit-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Maintenance Requests page */
        '<div class="pg" id="pg-maintenance">' +
            '<div class="ps" id="maintenance-container"><p class="empty">Loading...</p></div>' +
        '</div>';

    loadAnalytics();
}

/** Initialize the landlord dashboard with all pages. */
function initLandlord() {
    setNav([
        { lbl: 'Manage' },
        { t: 'Tenants', pg: 'll-tenants' },
        { t: 'Tasks', pg: 'll-tasks' },
        { t: 'Perks', pg: 'll-perks' },
        { t: 'Maintenance', pg: 'll-maintenance' },
        { sep: 1 },
        { lbl: 'Legal Tools' },
        { t: 'AI Chat', pg: 'chat' },
        { t: 'Notice Checker', pg: 'notice' }
    ]);

    var landlordQuickPrompts = [
        { label: 'Section 8 notice',  text: 'How to serve a Section 8 notice' },
        { label: 'Rent arrears',      text: 'Tenant not paying rent' },
        { label: 'Rent increase',     text: 'Can I increase rent?' }
    ];

    var landlordSidebar =
        '<div class="s-disc">Legal information for landlords under the Renters\' Rights Act 2025.</div>';

    var chatHtml = buildChatPageHtml(
        'Landlord Legal Guidance',
        'Ask about your obligations, tenant rights, notice requirements, and compliance.',
        landlordQuickPrompts,
        'Ask a legal question...',
        landlordSidebar
    );

    var noticeHtml = buildNoticePageHtml('Check if a notice is legally valid.');

    document.getElementById('pw').innerHTML =
        '<div class="pg on" id="pg-ll-tenants"><div class="ps" id="lltb"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-ll-tasks"><div class="ps" id="lltkb"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-ll-perks"><div class="ps" id="llpb"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-chat">' + chatHtml + '</div>' +
        '<div class="pg" id="pg-notice">' + noticeHtml + '</div>' +
        '<div class="pg" id="pg-ll-maintenance"><div class="ps" id="ll-maint-container"><p class="empty">Loading...</p></div></div>';

    loadLandlordPage('ll-tenants');
}

/** Initialize the admin dashboard. */
function initAdmin() {
    setNav([
        { lbl: 'Admin' },
        { t: 'Landlords', pg: 'admin-ll' }
    ]);
    document.getElementById('pw').innerHTML =
        '<div class="pg on" id="pg-admin-ll"><div class="ps" id="allb"><p class="empty">Loading...</p></div></div>';
    loadAdminLandlords();
}


/* --------------------------------------------------------------------------
   8. Chat (Send Messages, Bubbles, Analytics)
   -------------------------------------------------------------------------- */

/**
 * Send a pre-written quick prompt to the chat input and submit it.
 * @param {string} text - The prompt text to send
 */
function sendQuickPrompt(text) {
    document.getElementById('mi').value = text;
    sendMessage();
}

/**
 * Send the current chat message to the API and display the response.
 * Handles typing indicator, error fallback, urgency updates, and issue tracking.
 */
async function sendMessage() {
    var input = document.getElementById('mi');
    var message = input.value.trim();
    if (!message) return;

    /* Hide welcome, show user bubble, reset input */
    document.getElementById('wel').classList.add('hidden');
    addChatBubble(message, 'user');
    input.value = '';
    input.style.height = 'auto';

    /* Show typing indicator and disable send button */
    document.getElementById('dots').classList.remove('hidden');
    document.getElementById('sb').disabled = true;

    try {
        var userType = (currentUser.role === 'landlord') ? 'landlord' : 'tenant';
        var response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                session_id: sessionId,
                user_type: userType
            })
        });

        if (!response.ok) throw new Error('Chat request failed');

        var data = await response.json();
        sessionId = data.session_id;

        /* Hide typing indicator and show bot response */
        document.getElementById('dots').classList.add('hidden');
        addChatBubble(data.response, 'bot', data.urgency);

        /* Update session stats */
        messageCount++;
        var queryCounter = document.getElementById('sq');
        if (queryCounter) queryCounter.textContent = messageCount;

        if (data.urgency === 'critical' || data.urgency === 'high') {
            criticalCount++;
            var urgentCounter = document.getElementById('sc');
            if (urgentCounter) urgentCounter.textContent = criticalCount;
        }

        updateUrgencyBanner(data.urgency);
        updateIssueTracker(data.detected_issue);
        logRewardAction('rights_learned', data.detected_issue);

    } catch (error) {
        document.getElementById('dots').classList.add('hidden');
        addChatBubble('Could not process your request. Contact Shelter: 0808 800 4444', 'bot');
    }

    document.getElementById('sb').disabled = false;
    input.focus();
}

/**
 * Add a chat bubble to the feed.
 * @param {string} text - Message text
 * @param {string} type - 'user' or 'bot'
 * @param {string} [urgency] - Optional urgency level ('critical', 'high', etc.)
 */
function addChatBubble(text, type, urgency) {
    var feed = document.getElementById('feed');
    var bubble = document.createElement('div');
    bubble.className = 'bubble ' + type;

    /* Add critical styling and label for urgent bot messages */
    if (type === 'bot' && urgency === 'critical') {
        bubble.classList.add('crit');
        var urgencyLabel = document.createElement('div');
        urgencyLabel.className = 'u-label';
        urgencyLabel.textContent = 'URGENT';
        bubble.appendChild(urgencyLabel);
    }

    /* Add message content */
    var content = document.createElement('div');
    content.innerHTML = (type === 'bot') ? formatMarkdown(text) : text;
    bubble.appendChild(content);

    /* Add "Listen" button on bot messages */
    if (type === 'bot') {
        var listenButton = document.createElement('button');
        listenButton.className = 'voice';
        listenButton.textContent = 'Listen';
        listenButton.onclick = function() { playAudio(text, listenButton); };
        bubble.appendChild(listenButton);

        /* Auto-play audio for critical/high urgency */
        if (urgency === 'critical' || urgency === 'high') {
            setTimeout(function() { playAudio(text, listenButton); }, 600);
        }
    }

    feed.appendChild(bubble);
    feed.scrollTop = feed.scrollHeight;
}

/**
 * Update the urgency banner in the sidebar.
 * @param {string} urgency - Urgency level from the API
 */
function updateUrgencyBanner(urgency) {
    var banner = document.getElementById('ub');
    if (!banner) return;

    banner.className = 'urg';
    if (urgency === 'critical') {
        banner.className = 'urg crit';
        banner.textContent = 'Possible illegal eviction detected';
    } else if (urgency === 'high') {
        banner.className = 'urg high';
        banner.textContent = 'Eviction-related query';
    }
}

/**
 * Update the issue tracker in the sidebar with a newly detected issue.
 * @param {string} issue - Detected issue type (e.g., 'illegal_eviction')
 */
function updateIssueTracker(issue) {
    if (!issue) return;

    issueTracker[issue] = (issueTracker[issue] || 0) + 1;
    var container = document.getElementById('si');
    if (!container) return;
    container.innerHTML = renderIssueList(issueTracker);
}

/**
 * Load analytics data (total sessions, critical cases, issues) from the API.
 * Populates the sidebar stats on initial load.
 */
async function loadAnalytics() {
    try {
        var response = await fetch('/api/analytics/summary');
        if (!response.ok) return;

        var data = await response.json();

        messageCount = data.total_sessions || 0;
        var queryCounter = document.getElementById('sq');
        if (queryCounter) queryCounter.textContent = messageCount;

        criticalCount = data.critical_cases || 0;
        var urgentCounter = document.getElementById('sc');
        if (urgentCounter) urgentCounter.textContent = criticalCount;

        /* Populate issue tracker from analytics data */
        if (data.issues) {
            data.issues.forEach(function(item) {
                issueTracker[item.type] = item.count;
            });
        }

        var issueContainer = document.getElementById('si');
        if (issueContainer && Object.keys(issueTracker).length) {
            issueContainer.innerHTML = renderIssueList(issueTracker);
        }
    } catch (error) {
        /* Analytics is non-critical; silently fail */
    }
}


/* --------------------------------------------------------------------------
   9. Text-to-Speech (TTS)
   -------------------------------------------------------------------------- */

/**
 * Play or stop audio for a chat message.
 * Tries the MiniMax TTS API first, falls back to browser SpeechSynthesis.
 * @param {string} text - Message text to read aloud
 * @param {HTMLElement} button - The "Listen" button element
 */
async function playAudio(text, button) {
    /* If already playing, stop */
    if (button.classList.contains('playing')) {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        window.speechSynthesis.cancel();
        button.classList.remove('playing');
        button.textContent = 'Listen';
        return;
    }

    button.textContent = '...';
    button.disabled = true;

    try {
        /* Attempt MiniMax TTS */
        var response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: stripMarkdownForSpeech(text) })
        });

        if (!response.ok) throw new Error('TTS request failed');

        var data = await response.json();
        if (data.status === 'success' && data.audio_data) {
            var audio = new Audio('data:audio/mp3;base64,' + data.audio_data);
            currentAudio = audio;

            button.classList.add('playing');
            button.textContent = 'Playing...';
            button.disabled = false;

            audio.onended = function() {
                button.classList.remove('playing');
                button.textContent = 'Listen';
                currentAudio = null;
            };
            audio.onerror = audio.onended;
            await audio.play();
            return;
        }

        throw new Error('No audio data received');
    } catch (error) {
        /* Fallback to browser speech synthesis */
        button.disabled = false;

        var utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
        utterance.rate = 0.95;

        var voices = window.speechSynthesis.getVoices();
        var britishVoice = voices.find(function(v) { return v.lang === 'en-GB'; })
            || voices.find(function(v) { return v.lang.startsWith('en'); });
        if (britishVoice) utterance.voice = britishVoice;

        button.classList.add('playing');
        button.textContent = 'Playing...';

        utterance.onend = function() {
            button.classList.remove('playing');
            button.textContent = 'Listen';
        };
        utterance.onerror = utterance.onend;

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }
}

/* Pre-load speech synthesis voices */
if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function() {
        window.speechSynthesis.getVoices();
    };
}


/* --------------------------------------------------------------------------
   10. Notice Checker
   -------------------------------------------------------------------------- */

/**
 * Send the notice text to the API for legal analysis and display the result.
 */
async function checkNotice() {
    var noticeText = document.getElementById('nta').value.trim();
    if (!noticeText) return;

    var submitButton = document.getElementById('nbtn');
    var resultContainer = document.getElementById('nres');
    var resultBody = document.getElementById('ncon');

    submitButton.disabled = true;
    submitButton.textContent = 'Analyzing...';
    resultContainer.classList.add('show');
    resultBody.innerHTML = '<p style="color:var(--text-muted)">Analyzing notice...</p>';

    try {
        var response = await fetch('/api/notice/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notice_text: noticeText, session_id: sessionId })
        });

        if (!response.ok) throw new Error('Notice check failed');

        var data = await response.json();
        if (data.session_id) sessionId = data.session_id;
        resultBody.innerHTML = formatMarkdown(data.analysis);
        logRewardAction('notice_checked', '');
    } catch (error) {
        resultBody.textContent = 'Could not analyze. Try again.';
    }

    submitButton.disabled = false;
    submitButton.textContent = 'Analyze notice';
}


/* --------------------------------------------------------------------------
   11. Wellbeing Journal
   -------------------------------------------------------------------------- */

/**
 * Select a mood level on the wellbeing page.
 * @param {number} mood - Mood score from 1 to 5
 */
function pickMood(mood) {
    selectedMood = mood;
    document.querySelectorAll('.mood-b').forEach(function(btn) {
        btn.classList.remove('sel');
    });
    document.querySelector('.mood-b[data-m="' + mood + '"]').classList.add('sel');
    document.getElementById('ml').textContent = MOOD_LABELS[mood];
    document.getElementById('jbtn').disabled = false;
}

/**
 * Submit a wellbeing journal entry (mood + optional text) to the API.
 * Displays the AI-generated prompt and reflection on success.
 */
async function submitJournal() {
    if (!selectedMood) return;

    var journalText = document.getElementById('jta').value.trim();
    var submitButton = document.getElementById('jbtn');

    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';

    try {
        var response = await fetch('/api/wellbeing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                mood: selectedMood,
                journal_text: journalText || undefined
            })
        });

        if (!response.ok) throw new Error('Journal submission failed');

        var data = await response.json();
        if (data.session_id) sessionId = data.session_id;

        /* Display AI response */
        document.getElementById('ai-p').textContent = data.ai_prompt;
        document.getElementById('ai-r').textContent = data.ai_reflection;
        document.getElementById('ai-pts').textContent = '+' + data.points_earned + ' pts';
        document.getElementById('ai-out').classList.add('show');

        logRewardAction('journal_entry', 'Mood: ' + selectedMood);

        /* Reset the form */
        document.getElementById('jta').value = '';
        selectedMood = 0;
        document.querySelectorAll('.mood-b').forEach(function(btn) {
            btn.classList.remove('sel');
        });
        document.getElementById('ml').textContent = 'Select 1 to 5';

        loadWellbeingHistory();
    } catch (error) {
        document.getElementById('ai-p').textContent = 'Thank you for logging your mood.';
        document.getElementById('ai-out').classList.add('show');
    }

    submitButton.disabled = false;
    submitButton.textContent = 'Log entry';
}

/**
 * Load and render the mood history chart for the current session.
 */
async function loadWellbeingHistory() {
    if (!sessionId) return;

    try {
        var response = await fetch('/api/wellbeing/history/' + sessionId);
        if (!response.ok) return;

        var data = await response.json();
        var chart = document.getElementById('mch');
        if (!chart) return;

        chart.innerHTML = '';
        if (data.entries && data.entries.length) {
            /* Show most recent 14 entries, oldest first */
            data.entries.slice(0, 14).reverse().forEach(function(entry) {
                var bar = document.createElement('div');
                bar.className = 'mood-bar';
                bar.style.height = (entry.mood / 5 * 100) + '%';
                bar.style.background = MOOD_COLORS[entry.mood] || '#B0A695';
                chart.appendChild(bar);
            });
        }
    } catch (error) {
        /* Non-critical; silently fail */
    }
}


/* --------------------------------------------------------------------------
   12. Rewards & Gamification
   -------------------------------------------------------------------------- */

/**
 * Log a reward action to the API (fire-and-forget).
 * @param {string} actionType - e.g., 'rights_learned', 'journal_entry', 'notice_checked'
 * @param {string} details - Additional context about the action
 */
async function logRewardAction(actionType, details) {
    try {
        await fetch('/api/rewards/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                action_type: actionType,
                details: details || ''
            })
        });
    } catch (error) {
        /* Non-critical; silently fail */
    }
}

/**
 * Load and render the rewards profile (level, badges, vouchers).
 */
async function loadRewards() {
    if (!sessionId) return;

    try {
        var response = await fetch('/api/rewards/profile/' + sessionId);
        if (!response.ok) return;

        var data = await response.json();

        /* Update level display */
        document.getElementById('rl').textContent = data.level || 'Newcomer';
        document.getElementById('rp').textContent = data.total_points || 0;

        /* Calculate progress bar */
        var totalPoints = data.total_points || 0;
        var currentLevel = REWARD_LEVELS[0];
        var nextLevel = REWARD_LEVELS[1];

        for (var i = REWARD_LEVELS.length - 1; i >= 0; i--) {
            if (totalPoints >= REWARD_LEVELS[i].points) {
                currentLevel = REWARD_LEVELS[i];
                nextLevel = REWARD_LEVELS[i + 1] || null;
                break;
            }
        }

        if (nextLevel) {
            var progressPercent = Math.min(100, Math.round(
                (totalPoints - currentLevel.points) / (nextLevel.points - currentLevel.points) * 100
            ));
            document.getElementById('rb').style.width = progressPercent + '%';
            document.getElementById('rn').textContent = 'Next: ' + nextLevel.name + ' (' + nextLevel.points + ')';
        } else {
            document.getElementById('rb').style.width = '100%';
            document.getElementById('rn').textContent = 'Max level';
        }

        /* Render badges */
        var earnedBadgeIds = (data.badges || []).map(function(b) { return b.id; });
        var badgeGrid = document.getElementById('rbg');
        if (badgeGrid) {
            badgeGrid.innerHTML = ALL_BADGES.map(function(badge) {
                var isEarned = earnedBadgeIds.includes(badge.id);
                return '<div class="b-card ' + (isEarned ? 'earned' : 'locked') + '">' +
                    '<div class="b-icon">' + badge.name.charAt(0) + '</div>' +
                    '<div class="b-name">' + badge.name + '</div>' +
                    '<div class="b-desc">' + badge.description + '</div>' +
                '</div>';
            }).join('');
        }

        /* Render vouchers */
        var voucherContainer = document.getElementById('rv');
        if (voucherContainer && (data.vouchers || []).length) {
            voucherContainer.innerHTML = data.vouchers.map(function(voucher) {
                return '<div class="card"><h4 style="color:var(--success)">' + (voucher.title || 'Voucher') +
                    '</h4><p>' + (voucher.description || '') + '</p></div>';
            }).join('');
        }
    } catch (error) {
        /* Non-critical; silently fail */
    }
}


/* --------------------------------------------------------------------------
   13. Tenant Tasks & Perks
   -------------------------------------------------------------------------- */

/**
 * Load and render the tenant's tasks and available perks.
 */
async function loadTenantTasks() {
    var container = document.getElementById('ttb');
    var tasks = [];
    var perks = [];
    var profile = {};

    try {
        var results = await Promise.all([
            fetch('/api/tasks', { headers: getAuthHeaders() }),
            fetch('/api/perks', { headers: getAuthHeaders() }),
            fetch('/api/users/me', { headers: getAuthHeaders() })
        ]);

        if (results[0].ok) tasks = await results[0].json();
        if (results[1].ok) perks = await results[1].json();
        if (results[2].ok) profile = await results[2].json();
    } catch (error) {
        /* Continue with empty data */
    }

    var userPoints = profile.points || 0;
    var todoTasks = tasks.filter(function(t) { return t.status === 'pending' || t.status === 'rejected'; });
    var submittedTasks = tasks.filter(function(t) { return t.status === 'submitted'; });
    var completedTasks = tasks.filter(function(t) { return t.status === 'approved'; });

    var html = '<h2 class="ph">Tasks & Perks</h2>' +
        '<div style="text-align:center;margin:16px 0">' +
            '<div class="pts-big">' + userPoints + '</div>' +
            '<div style="color:var(--text-muted);font-size:11px">points</div>' +
        '</div>';

    /* To-do tasks */
    if (todoTasks.length) {
        html += '<div class="sec">To do (' + todoTasks.length + ')</div><div class="grid">';
        todoTasks.forEach(function(task) {
            html += '<div class="card">' +
                '<span class="badge b-' + task.status + '">' + task.status + '</span>' +
                '<h4>' + task.title + '</h4>' +
                '<p>' + (task.description || task.category) + ' &middot; ' + task.points_reward + ' pts</p>' +
                (task.rejection_reason ? '<div class="meta" style="color:var(--danger)">Feedback: ' + task.rejection_reason + '</div>' : '') +
                '<div class="acts">' +
                    '<button class="btn btn-p btn-sm" onclick="document.getElementById(\'up-' + task.task_id + '\').click()">Upload proof</button>' +
                    '<input type="file" id="up-' + task.task_id + '" accept="image/*" style="display:none" onchange="submitProof(\'' + task.task_id + '\',this)">' +
                '</div>' +
            '</div>';
        });
        html += '</div>';
    }

    /* Submitted tasks awaiting review */
    if (submittedTasks.length) {
        html += '<div class="sec">Awaiting review (' + submittedTasks.length + ')</div><div class="grid">';
        submittedTasks.forEach(function(task) {
            html += '<div class="card">' +
                '<span class="badge b-submitted">submitted</span>' +
                '<h4>' + task.title + '</h4><p>' + task.points_reward + ' pts</p>' +
                (task.proof_image ? '<img class="proof" src="' + task.proof_image + '">' : '') +
            '</div>';
        });
        html += '</div>';
    }

    /* Completed tasks */
    if (completedTasks.length) {
        html += '<div class="sec">Completed (' + completedTasks.length + ')</div><div class="grid">';
        completedTasks.forEach(function(task) {
            html += '<div class="card">' +
                '<span class="badge b-approved">approved</span>' +
                '<h4>' + task.title + '</h4><p>+' + task.points_reward + ' pts</p>' +
            '</div>';
        });
        html += '</div>';
    }

    /* Available perks */
    html += '<div class="sec">Available perks</div><div class="grid">';
    if (perks.length) {
        perks.forEach(function(perk) {
            var canClaim = userPoints >= perk.points_cost;
            html += '<div class="card">' +
                '<h4>' + perk.title + '</h4><p>' + perk.description + '</p>' +
                '<div class="meta">' + perk.points_cost + ' pts</div>' +
                '<div class="acts">' +
                    '<button class="btn ' + (canClaim ? 'btn-g' : 'btn-o') + ' btn-sm" ' +
                        'onclick="claimPerk(\'' + perk.perk_id + '\')" ' + (canClaim ? '' : 'disabled') + '>' +
                        (canClaim ? 'Claim' : 'Need ' + perk.points_cost + ' pts') +
                    '</button>' +
                '</div>' +
            '</div>';
        });
    } else {
        html += '<p class="empty">No perks available yet.</p>';
    }
    html += '</div>';

    container.innerHTML = html;
}

/**
 * Upload a proof photo for a task.
 * @param {string} taskId - The task to submit proof for
 * @param {HTMLInputElement} fileInput - The file input element
 */
async function submitProof(taskId, fileInput) {
    if (!fileInput.files || !fileInput.files[0]) return;

    var formData = new FormData();
    formData.append('photo', fileInput.files[0]);

    try {
        var response = await fetch('/api/tasks/' + taskId + '/submit', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
            body: formData
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Upload failed.');
            alert(errMsg);
            return;
        }

        alert('Proof submitted successfully.');
        loadTenantTasks();
    } catch (error) {
        alert('Upload error.');
    }
}

/**
 * Claim a perk using earned points.
 * @param {string} perkId - The perk to claim
 */
async function claimPerk(perkId) {
    if (!confirm('Claim this perk?')) return;

    try {
        var response = await fetch('/api/perks/' + perkId + '/claim', {
            method: 'POST',
            headers: getAuthHeaders()
        });
        var data = await response.json();
        alert(data.message);
        loadTenantTasks();
    } catch (error) {
        alert('Error.');
    }
}


/* --------------------------------------------------------------------------
   14. Landlord Management Pages
   -------------------------------------------------------------------------- */

/**
 * Load a landlord management page (tenants, tasks, or perks).
 * @param {string} page - 'll-tenants', 'll-tasks', or 'll-perks'
 */
async function loadLandlordPage(page) {

    /* --- Tenants page --- */
    if (page === 'll-tenants') {
        var tenantsContainer = document.getElementById('lltb');
        var tenants = [];

        try {
            var tenantsResponse = await fetch('/api/landlord/tenants', { headers: getAuthHeaders() });
            if (tenantsResponse.ok) tenants = await tenantsResponse.json();
        } catch (error) { /* Continue with empty data */ }

        tenantsContainer.innerHTML =
            '<h2 class="ph">Tenants</h2>' +
            '<p class="pp">Manage tenants under your properties.</p>' +
            '<div class="card">' +
                '<h4>Add tenant</h4>' +
                '<div class="row">' +
                    '<div class="fg"><label>Name</label><input class="inp" id="lt-n" placeholder="Full name"></div>' +
                    '<div class="fg"><label>Email</label><input class="inp" id="lt-e" placeholder="Email address"></div>' +
                    '<div class="fg"><label>Password</label><input class="inp" id="lt-p" type="password" placeholder="Password"></div>' +
                    '<div class="fg"><label>Property</label><input class="inp" id="lt-pr" placeholder="Address"></div>' +
                    '<div class="fg" style="flex:0"><label>&nbsp;</label><button class="btn btn-p" onclick="addTenant()">Add</button></div>' +
                '</div>' +
                '<div class="msg-t" id="lt-m"></div>' +
            '</div>' +
            '<div class="sec">Tenants (' + tenants.length + ')</div>' +
            '<div class="grid">' +
                (tenants.length
                    ? tenants.map(function(tenant) {
                        return '<div class="card">' +
                            '<h4>' + tenant.name + '</h4>' +
                            '<p>' + tenant.email + '</p>' +
                            '<div class="meta">' + (tenant.property_address || 'No address') + ' &middot; ' + (tenant.points || 0) + ' pts</div>' +
                            '<div class="acts">' +
                                '<button class="btn btn-o btn-sm" onclick="generateResetToken(\'' + tenant.email + '\')">Reset Password</button>' +
                                '<button class="btn btn-d btn-sm" onclick="removeTenant(\'' + tenant.user_id + '\')">Remove</button>' +
                            '</div>' +
                        '</div>';
                    }).join('')
                    : '<p class="empty">No tenants yet.</p>'
                ) +
            '</div>';
    }

    /* --- Tasks page --- */
    if (page === 'll-tasks') {
        var tasksContainer = document.getElementById('lltkb');
        var taskTenants = [];
        var allTasks = [];

        try {
            var taskResults = await Promise.all([
                fetch('/api/landlord/tenants', { headers: getAuthHeaders() }),
                fetch('/api/tasks', { headers: getAuthHeaders() })
            ]);
            if (taskResults[0].ok) taskTenants = await taskResults[0].json();
            if (taskResults[1].ok) allTasks = await taskResults[1].json();
        } catch (error) { /* Continue with empty data */ }

        var pendingTasks = allTasks.filter(function(t) { return t.status === 'submitted'; });

        var tenantOptions = taskTenants.map(function(t) {
            return '<option value="' + t.user_id + '">' + t.name + '</option>';
        }).join('');

        var tasksHtml =
            '<h2 class="ph">Tasks</h2>' +
            '<p class="pp">Assign tasks to tenants, review submissions, and award points.</p>' +
            '<div class="card">' +
                '<h4>Assign task</h4>' +
                '<div class="row">' +
                    '<div class="fg"><label>Title</label><input class="inp" id="lk-t" placeholder="Task title"></div>' +
                    '<div class="fg"><label>Tenant</label><select class="inp" id="lk-tid">' + tenantOptions + '</select></div>' +
                    '<div class="fg"><label>Points</label><input class="inp" id="lk-pts" type="number" value="10" min="1"></div>' +
                    '<div class="fg"><label>Category</label><select class="inp" id="lk-cat"><option>cleaning</option><option>maintenance</option><option>energy_saving</option><option>community</option><option>general</option></select></div>' +
                    '<div class="fg" style="flex:0"><label>&nbsp;</label><button class="btn btn-p" onclick="assignTask()">Assign</button></div>' +
                '</div>' +
                '<div class="msg-t" id="lk-m"></div>' +
            '</div>';

        /* Tasks needing review */
        if (pendingTasks.length) {
            tasksHtml += '<div class="sec">Review needed (' + pendingTasks.length + ')</div><div class="grid">';
            pendingTasks.forEach(function(task) {
                tasksHtml += '<div class="card">' +
                    '<span class="badge b-submitted">submitted</span>' +
                    '<h4>' + task.title + '</h4>' +
                    '<p>' + task.tenant_name + ' &middot; ' + task.points_reward + ' pts</p>' +
                    (task.proof_image ? '<img class="proof" src="' + task.proof_image + '">' : '') +
                    '<div class="acts">' +
                        '<button class="btn btn-g btn-sm" onclick="verifyTask(\'' + task.task_id + '\',true)">Approve</button>' +
                        '<button class="btn btn-d btn-sm" onclick="verifyTask(\'' + task.task_id + '\',false)">Reject</button>' +
                    '</div>' +
                '</div>';
            });
            tasksHtml += '</div>';
        }

        /* All tasks list */
        tasksHtml += '<div class="sec">All tasks (' + allTasks.length + ')</div><div class="grid">';
        if (allTasks.length) {
            allTasks.forEach(function(task) {
                tasksHtml += '<div class="card">' +
                    '<span class="badge b-' + task.status + '">' + task.status + '</span>' +
                    '<h4>' + task.title + '</h4>' +
                    '<p>' + (task.tenant_name || 'Unassigned') + ' &middot; ' + task.points_reward + ' pts &middot; ' + task.category + '</p>' +
                    (task.proof_image ? '<img class="proof" src="' + task.proof_image + '">' : '') +
                    (task.rejection_reason ? '<div class="meta" style="color:var(--danger)">Rejected: ' + task.rejection_reason + '</div>' : '') +
                '</div>';
            });
        } else {
            tasksHtml += '<p class="empty">No tasks yet.</p>';
        }
        tasksHtml += '</div>';

        tasksContainer.innerHTML = tasksHtml;
    }

    /* --- Perks page --- */
    if (page === 'll-perks') {
        var perksContainer = document.getElementById('llpb');
        var landlordPerks = [];
        var perkClaims = [];

        try {
            var perkResults = await Promise.all([
                fetch('/api/perks', { headers: getAuthHeaders() }),
                fetch('/api/perks/claims', { headers: getAuthHeaders() })
            ]);
            if (perkResults[0].ok) landlordPerks = await perkResults[0].json();
            if (perkResults[1].ok) perkClaims = await perkResults[1].json();
        } catch (error) { /* Continue with empty data */ }

        var perksHtml =
            '<h2 class="ph">Perks</h2>' +
            '<p class="pp">Create perks that tenants can claim with their earned points.</p>' +
            '<div class="card">' +
                '<h4>Create perk</h4>' +
                '<div class="row">' +
                    '<div class="fg"><label>Title</label><input class="inp" id="lp-t" placeholder="e.g. Rent discount"></div>' +
                    '<div class="fg"><label>Description</label><input class="inp" id="lp-d" placeholder="Details"></div>' +
                    '<div class="fg"><label>Cost (pts)</label><input class="inp" id="lp-c" type="number" value="50" min="1"></div>' +
                    '<div class="fg" style="flex:0"><label>&nbsp;</label><button class="btn btn-p" onclick="createPerk()">Create</button></div>' +
                '</div>' +
                '<div class="msg-t" id="lp-m"></div>' +
            '</div>';

        /* Existing perks */
        perksHtml += '<div class="sec">Perks (' + landlordPerks.length + ')</div><div class="grid">';
        if (landlordPerks.length) {
            landlordPerks.forEach(function(perk) {
                perksHtml += '<div class="card">' +
                    '<h4>' + perk.title + '</h4><p>' + perk.description + '</p>' +
                    '<div class="meta">' + perk.points_cost + ' pts &middot; Claimed ' + perk.claimed_count + 'x</div>' +
                    '<div class="acts"><button class="btn btn-d btn-sm" onclick="deletePerk(\'' + perk.perk_id + '\')">Delete</button></div>' +
                '</div>';
            });
        } else {
            perksHtml += '<p class="empty">No perks yet.</p>';
        }
        perksHtml += '</div>';

        /* Claims */
        if (perkClaims.length) {
            perksHtml += '<div class="sec">Claims</div><div class="grid">';
            perkClaims.forEach(function(claim) {
                perksHtml += '<div class="card"><h4>' + claim.perk_title + '</h4><p>' + claim.tenant_name + ' &middot; ' + claim.points_spent + ' pts</p></div>';
            });
            perksHtml += '</div>';
        }

        perksContainer.innerHTML = perksHtml;
    }
}

/**
 * Add a new tenant to the landlord's property.
 */
async function addTenant() {
    var name = document.getElementById('lt-n').value.trim();
    var email = document.getElementById('lt-e').value.trim();
    var password = document.getElementById('lt-p').value;
    var propertyAddress = document.getElementById('lt-pr').value.trim();
    var messageDisplay = document.getElementById('lt-m');

    if (!name || !email || !password) {
        messageDisplay.textContent = 'Fill all required fields.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    try {
        var response = await fetch('/api/landlord/tenants', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name, email: email, password: password, property_address: propertyAddress })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to create tenant.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Tenant created.';
        messageDisplay.className = 'msg-t msg-ok';
        ['lt-n', 'lt-e', 'lt-p', 'lt-pr'].forEach(function(id) {
            document.getElementById(id).value = '';
        });
        setTimeout(function() { loadLandlordPage('ll-tenants'); }, 400);
    } catch (error) {
        messageDisplay.textContent = 'Error.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/**
 * Remove a tenant from the landlord's property.
 * @param {string} tenantId - The tenant's user ID
 */
async function removeTenant(tenantId) {
    if (!confirm('Remove this tenant?')) return;
    await fetch('/api/landlord/tenants/' + tenantId, { method: 'DELETE', headers: getAuthHeaders() });
    loadLandlordPage('ll-tenants');
}

/**
 * Generate a password reset token for a user (landlord resets tenant, admin resets anyone).
 * Displays the token in an alert so the manager can share it with the user.
 * @param {string} email - The user's email address
 */
async function generateResetToken(email) {
    if (!confirm('Generate a password reset token for ' + email + '?')) return;

    try {
        var response = await fetch('/api/auth/request-reset', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ email: email })
        });

        var data = await response.json();

        if (!response.ok) {
            alert(data.detail || 'Could not generate reset token.');
            return;
        }

        if (data.reset_token) {
            /* Copy token to clipboard if possible, otherwise show in prompt */
            if (navigator.clipboard) {
                navigator.clipboard.writeText(data.reset_token);
                alert('Reset token copied to clipboard. Share it with the user.\n\nToken: ' + data.reset_token + '\n\nExpires in 1 hour.');
            } else {
                prompt('Share this reset token with the user (expires in 1 hour):', data.reset_token);
            }
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert('Connection error.');
    }
}

/**
 * Assign a new task to a tenant.
 */
async function assignTask() {
    var title = document.getElementById('lk-t').value.trim();
    var tenantId = document.getElementById('lk-tid').value;
    var pointsReward = parseInt(document.getElementById('lk-pts').value) || 10;
    var category = document.getElementById('lk-cat').value;
    var messageDisplay = document.getElementById('lk-m');

    if (!title || !tenantId) {
        messageDisplay.textContent = 'Fill required fields.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    try {
        var response = await fetch('/api/tasks', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title: title, tenant_id: tenantId, points_reward: pointsReward, category: category })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to assign task.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Task assigned.';
        messageDisplay.className = 'msg-t msg-ok';
        document.getElementById('lk-t').value = '';
        setTimeout(function() { loadLandlordPage('ll-tasks'); }, 400);
    } catch (error) {
        messageDisplay.textContent = 'Error.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/**
 * Approve or reject a tenant's task submission.
 * @param {string} taskId - The task ID
 * @param {boolean} isApproved - true to approve, false to reject
 */
async function verifyTask(taskId, isApproved) {
    var rejectionReason = '';
    if (!isApproved) {
        rejectionReason = window.prompt('Reason for rejection:') || 'Please redo.';
    }

    await fetch('/api/tasks/' + taskId + '/verify', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ approved: isApproved, reason: rejectionReason })
    });

    loadLandlordPage('ll-tasks');
}

/**
 * Create a new perk that tenants can claim.
 */
async function createPerk() {
    var title = document.getElementById('lp-t').value.trim();
    var description = document.getElementById('lp-d').value.trim();
    var pointsCost = parseInt(document.getElementById('lp-c').value) || 50;
    var messageDisplay = document.getElementById('lp-m');

    if (!title) {
        messageDisplay.textContent = 'Enter a title.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    try {
        var response = await fetch('/api/perks', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ title: title, description: description, points_cost: pointsCost })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to create perk.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Perk created.';
        messageDisplay.className = 'msg-t msg-ok';
        ['lp-t', 'lp-d'].forEach(function(id) {
            document.getElementById(id).value = '';
        });
        setTimeout(function() { loadLandlordPage('ll-perks'); }, 400);
    } catch (error) {
        messageDisplay.textContent = 'Error.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/**
 * Delete a perk created by the landlord.
 * @param {string} perkId - The perk ID
 */
async function deletePerk(perkId) {
    if (!confirm('Delete this perk?')) return;
    await fetch('/api/perks/' + perkId, { method: 'DELETE', headers: getAuthHeaders() });
    loadLandlordPage('ll-perks');
}


/* --------------------------------------------------------------------------
   15. Admin Management
   -------------------------------------------------------------------------- */

/**
 * Load and render the admin landlords management page.
 */
async function loadAdminLandlords() {
    var container = document.getElementById('allb');
    var landlords = [];

    try {
        var response = await fetch('/api/admin/landlords', { headers: getAuthHeaders() });
        if (response.ok) landlords = await response.json();
    } catch (error) { /* Continue with empty data */ }

    container.innerHTML =
        '<h2 class="ph">Landlords</h2>' +
        '<p class="pp">Create and manage landlord accounts.</p>' +
        '<div class="card">' +
            '<h4>Create landlord</h4>' +
            '<div class="row">' +
                '<div class="fg"><label>Name</label><input class="inp" id="al-n" placeholder="Full name"></div>' +
                '<div class="fg"><label>Email</label><input class="inp" id="al-e" placeholder="Email address"></div>' +
                '<div class="fg"><label>Password</label><input class="inp" id="al-p" type="password" placeholder="Password"></div>' +
                '<div class="fg" style="flex:0"><label>&nbsp;</label><button class="btn btn-p" onclick="addLandlord()">Create</button></div>' +
            '</div>' +
            '<div class="msg-t" id="al-m"></div>' +
        '</div>' +
        '<div class="sec">Landlords (' + landlords.length + ')</div>' +
        '<div class="grid">' +
            (landlords.length
                ? landlords.map(function(landlord) {
                    return '<div class="card">' +
                        '<h4>' + landlord.name + '</h4><p>' + landlord.email + '</p>' +
                        '<div class="meta">' + ((landlord.properties || []).join(', ') || 'No properties') + '</div>' +
                        '<div class="acts">' +
                            '<button class="btn btn-o btn-sm" onclick="generateResetToken(\'' + landlord.email + '\')">Reset Password</button>' +
                            '<button class="btn btn-d btn-sm" onclick="removeLandlord(\'' + landlord.user_id + '\')">Delete</button>' +
                        '</div>' +
                    '</div>';
                }).join('')
                : '<p class="empty">No landlords yet.</p>'
            ) +
        '</div>';
}

/**
 * Create a new landlord account.
 */
async function addLandlord() {
    var name = document.getElementById('al-n').value.trim();
    var email = document.getElementById('al-e').value.trim();
    var password = document.getElementById('al-p').value;
    var messageDisplay = document.getElementById('al-m');

    if (!name || !email || !password) {
        messageDisplay.textContent = 'Fill all fields.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    try {
        var response = await fetch('/api/admin/landlords', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: name, email: email, password: password })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to create landlord.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Landlord created.';
        messageDisplay.className = 'msg-t msg-ok';
        ['al-n', 'al-e', 'al-p'].forEach(function(id) {
            document.getElementById(id).value = '';
        });
        setTimeout(function() { loadAdminLandlords(); }, 400);
    } catch (error) {
        console.error('addLandlord error:', error);
        messageDisplay.textContent = error.message || 'Connection error. Check server is running.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/**
 * Delete a landlord account and all their tenants.
 * @param {string} landlordId - The landlord's user ID
 */
async function removeLandlord(landlordId) {
    if (!confirm('Delete this landlord and all their tenants?')) return;
    await fetch('/api/admin/landlords/' + landlordId, { method: 'DELETE', headers: getAuthHeaders() });
    loadAdminLandlords();
}


/* --------------------------------------------------------------------------
   16. Evidence Locker
   -------------------------------------------------------------------------- */

/** Human-readable evidence category labels */
var EVIDENCE_CATEGORIES = {
    mould_damp: 'Mould / Damp',
    property_damage: 'Property Damage',
    correspondence: 'Correspondence',
    notice_letter: 'Notice / Letter',
    repair_request: 'Repair Request',
    photo_condition: 'Property Condition',
    receipt_payment: 'Receipt / Payment',
    other: 'Other'
};

/**
 * Load and render the evidence locker page.
 */
async function loadEvidence() {
    var container = document.getElementById('evidence-container');
    var items = [];

    try {
        var response = await fetch('/api/evidence', { headers: getAuthHeaders() });
        if (response.ok) items = await response.json();
    } catch (error) { /* Continue with empty */ }

    var categoryOptions = Object.keys(EVIDENCE_CATEGORIES).map(function(key) {
        return '<option value="' + key + '">' + EVIDENCE_CATEGORIES[key] + '</option>';
    }).join('');

    var html =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
            '<h2 class="ph">Evidence Locker</h2>' +
            '<button class="export-btn" onclick="exportEvidencePdf()" aria-label="Export evidence list as PDF">Export PDF</button>' +
        '</div>' +
        '<p class="pp">Upload and organize photos, documents, and screenshots as timestamped evidence. ' +
            'These can be exported as a PDF for use in disputes or tribunal proceedings.</p>' +

        /* Upload form */
        '<div class="card">' +
            '<h4>Add Evidence</h4>' +
            '<div class="row">' +
                '<div class="fg"><label>Title</label><input class="inp" id="ev-title" placeholder="e.g. Mould in bathroom"></div>' +
                '<div class="fg"><label>Category</label><select class="inp" id="ev-cat">' + categoryOptions + '</select></div>' +
            '</div>' +
            '<div class="fld" style="margin-top:8px">' +
                '<label>Description</label>' +
                '<input class="inp" id="ev-desc" placeholder="Brief description of what this shows...">' +
            '</div>' +
            '<div class="fld">' +
                '<label>File (image or PDF, max 10 MB)</label>' +
                '<input type="file" id="ev-file" accept="image/*,.pdf" class="inp">' +
            '</div>' +
            '<button class="btn btn-p" onclick="uploadEvidence()">Upload</button>' +
            '<div class="msg-t" id="ev-msg" role="alert"></div>' +
        '</div>';

    /* Evidence list grouped by category */
    if (items.length) {
        html += '<div class="sec">Your Evidence (' + items.length + ' items)</div>';
        html += '<div class="evidence-grid">';
        items.forEach(function(item) {
            var isImage = item.file_type && item.file_type.startsWith('image/');
            var dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-GB') : '';
            html += '<div class="card evidence-card">' +
                (isImage
                    ? '<img class="evidence-thumb" src="' + item.file_url + '" alt="' + item.title + '">'
                    : '<div class="evidence-file-icon">PDF</div>'
                ) +
                '<div class="evidence-info">' +
                    '<h4>' + item.title + '</h4>' +
                    '<span class="badge b-pending">' + (EVIDENCE_CATEGORIES[item.category] || item.category) + '</span>' +
                    (item.description ? '<p>' + item.description + '</p>' : '') +
                    '<div class="meta">' + dateStr + ' &middot; ' + formatFileSize(item.file_size) + '</div>' +
                '</div>' +
                '<div class="acts">' +
                    '<a href="' + item.file_url + '" target="_blank" class="btn btn-o btn-sm">View</a>' +
                    '<button class="btn btn-d btn-sm" onclick="deleteEvidence(\'' + item.evidence_id + '\')">Delete</button>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';
    } else {
        html += '<p class="empty" style="text-align:center;padding:20px">No evidence uploaded yet. Start building your case file above.</p>';
    }

    container.innerHTML = html;
}

/**
 * Upload an evidence file to the API.
 */
async function uploadEvidence() {
    var fileInput = document.getElementById('ev-file');
    var title = document.getElementById('ev-title').value.trim();
    var category = document.getElementById('ev-cat').value;
    var description = document.getElementById('ev-desc').value.trim();
    var messageDisplay = document.getElementById('ev-msg');

    if (!fileInput.files || !fileInput.files[0]) {
        messageDisplay.textContent = 'Select a file to upload.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    var formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('title', title);
    formData.append('category', category);
    formData.append('description', description);

    messageDisplay.textContent = 'Uploading...';
    messageDisplay.className = 'msg-t';

    try {
        var response = await fetch('/api/evidence', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
            body: formData
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Upload failed.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Evidence uploaded.';
        messageDisplay.className = 'msg-t msg-ok';
        document.getElementById('ev-title').value = '';
        document.getElementById('ev-desc').value = '';
        fileInput.value = '';

        setTimeout(function() { loadEvidence(); }, 500);
    } catch (error) {
        messageDisplay.textContent = 'Upload error.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/**
 * Delete an evidence item.
 * @param {string} evidenceId
 */
async function deleteEvidence(evidenceId) {
    if (!confirm('Delete this evidence? This cannot be undone.')) return;

    await fetch('/api/evidence/' + evidenceId, { method: 'DELETE', headers: getAuthHeaders() });
    loadEvidence();
}

/**
 * Format file size in human-readable form.
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Export evidence list as a PDF inventory.
 */
async function exportEvidencePdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    var items = [];
    try {
        var response = await fetch('/api/evidence', { headers: getAuthHeaders() });
        if (response.ok) items = await response.json();
    } catch (error) { /* Continue with empty */ }

    if (!items.length) { alert('No evidence to export.'); return; }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RentShield - Evidence Inventory', 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB') + '  |  ' + items.length + ' items', 14, 28);
    doc.setTextColor(0);
    doc.line(14, 32, 196, 32);

    var y = 40;
    items.forEach(function(item, index) {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text((index + 1) + '. ' + item.title, 14, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.text('Category: ' + (EVIDENCE_CATEGORIES[item.category] || item.category) +
            '  |  Date: ' + (item.created_at ? new Date(item.created_at).toLocaleDateString('en-GB') : 'N/A') +
            '  |  File: ' + item.original_filename, 14, y);
        y += 5;
        if (item.description) {
            var lines = doc.splitTextToSize('Description: ' + item.description, 170);
            doc.text(lines, 14, y);
            y += lines.length * 4 + 2;
        }
        y += 4;
    });

    doc.save('rentshield-evidence-' + formatDateForFilename() + '.pdf');
}


/* --------------------------------------------------------------------------
   17. Dispute Timeline
   -------------------------------------------------------------------------- */

/** Human-readable event type labels */
var EVENT_TYPES = {
    message_sent: 'Message Sent',
    message_received: 'Message Received',
    phone_call: 'Phone Call',
    repair_requested: 'Repair Requested',
    repair_completed: 'Repair Completed',
    notice_received: 'Notice Received',
    notice_sent: 'Notice Sent',
    complaint_filed: 'Complaint Filed',
    inspection: 'Inspection',
    payment_made: 'Payment Made',
    meeting: 'Meeting',
    other: 'Other'
};

/** Color for each event type dot on the timeline */
var EVENT_COLORS = {
    message_sent: '#776B5D',
    message_received: '#B0A695',
    phone_call: '#776B5D',
    repair_requested: '#8A6D2F',
    repair_completed: '#3D7A4A',
    notice_received: '#A83232',
    notice_sent: '#A83232',
    complaint_filed: '#A83232',
    inspection: '#8A6D2F',
    payment_made: '#3D7A4A',
    meeting: '#776B5D',
    other: '#B0A695'
};

/**
 * Load and render the dispute timeline page.
 */
async function loadTimeline() {
    var container = document.getElementById('timeline-container');
    var events = [];

    try {
        var response = await fetch('/api/timeline', { headers: getAuthHeaders() });
        if (response.ok) events = await response.json();
    } catch (error) { /* Continue with empty */ }

    var typeOptions = Object.keys(EVENT_TYPES).map(function(key) {
        return '<option value="' + key + '">' + EVENT_TYPES[key] + '</option>';
    }).join('');

    var html =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
            '<h2 class="ph">Dispute Timeline</h2>' +
            '<button class="export-btn" onclick="exportTimelinePdf()" aria-label="Export timeline as PDF">Export PDF</button>' +
        '</div>' +
        '<p class="pp">Log every interaction with your landlord to build a chronological case file. ' +
            'This creates a dated record for Shelter, Citizens Advice, or a tribunal.</p>' +

        /* Add event form */
        '<div class="card">' +
            '<h4>Log Event</h4>' +
            '<div class="row">' +
                '<div class="fg"><label>Title</label><input class="inp" id="tl-title" placeholder="e.g. Emailed landlord about leak"></div>' +
                '<div class="fg"><label>Type</label><select class="inp" id="tl-type">' + typeOptions + '</select></div>' +
                '<div class="fg"><label>Date</label><input class="inp" id="tl-date" type="date"></div>' +
            '</div>' +
            '<div class="fld" style="margin-top:8px">' +
                '<label>Details</label>' +
                '<textarea class="inp" id="tl-desc" placeholder="What happened? Include names, times, and what was said..." rows="3" style="resize:vertical;min-height:60px"></textarea>' +
            '</div>' +
            '<button class="btn btn-p" onclick="addTimelineEvent()">Log Event</button>' +
            '<div class="msg-t" id="tl-msg" role="alert"></div>' +
        '</div>';

    /* Timeline events */
    if (events.length) {
        html += '<div class="sec">Timeline (' + events.length + ' events)</div>';
        html += '<div class="timeline-list">';
        events.forEach(function(event) {
            var eventDate = event.event_date
                ? new Date(event.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                : '';
            var dotColor = EVENT_COLORS[event.event_type] || '#B0A695';

            html += '<div class="timeline-item">' +
                '<div class="timeline-dot" style="background:' + dotColor + '"></div>' +
                '<div class="timeline-content">' +
                    '<div class="timeline-date">' + eventDate + '</div>' +
                    '<span class="badge b-pending">' + (EVENT_TYPES[event.event_type] || event.event_type) + '</span>' +
                    '<h4>' + event.title + '</h4>' +
                    (event.description ? '<p>' + event.description + '</p>' : '') +
                    '<div class="acts">' +
                        '<button class="btn btn-d btn-sm" onclick="deleteTimelineEvent(\'' + event.event_id + '\')">Delete</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';
    } else {
        html += '<p class="empty" style="text-align:center;padding:20px">No events logged yet. Start documenting interactions above.</p>';
    }

    container.innerHTML = html;

    /* Set default date to today */
    var dateInput = document.getElementById('tl-date');
    if (dateInput) dateInput.value = formatDateForFilename();
}

/**
 * Add a new event to the dispute timeline.
 */
async function addTimelineEvent() {
    var title = document.getElementById('tl-title').value.trim();
    var eventType = document.getElementById('tl-type').value;
    var eventDate = document.getElementById('tl-date').value;
    var description = document.getElementById('tl-desc').value.trim();
    var messageDisplay = document.getElementById('tl-msg');

    if (!title) {
        messageDisplay.textContent = 'Enter an event title.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    try {
        var response = await fetch('/api/timeline', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                title: title,
                event_type: eventType,
                event_date: eventDate ? new Date(eventDate).toISOString() : undefined,
                description: description
            })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to log event.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Event logged.';
        messageDisplay.className = 'msg-t msg-ok';
        document.getElementById('tl-title').value = '';
        document.getElementById('tl-desc').value = '';

        setTimeout(function() { loadTimeline(); }, 500);
    } catch (error) {
        messageDisplay.textContent = 'Connection error.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/**
 * Delete a timeline event.
 * @param {string} eventId
 */
async function deleteTimelineEvent(eventId) {
    if (!confirm('Delete this event?')) return;
    await fetch('/api/timeline/' + eventId, { method: 'DELETE', headers: getAuthHeaders() });
    loadTimeline();
}

/**
 * Export the dispute timeline as a PDF case file.
 */
async function exportTimelinePdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    var events = [];
    try {
        var response = await fetch('/api/timeline', { headers: getAuthHeaders() });
        if (response.ok) events = await response.json();
    } catch (error) { /* Continue with empty */ }

    if (!events.length) { alert('No timeline events to export.'); return; }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RentShield - Dispute Timeline', 14, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB') + '  |  ' + events.length + ' events', 14, 28);
    doc.text('This timeline is a chronological record of interactions related to a housing dispute.', 14, 33);
    doc.setTextColor(0);
    doc.line(14, 36, 196, 36);

    var y = 44;
    /* Reverse to show oldest first in the PDF */
    events.slice().reverse().forEach(function(event, index) {
        if (y > 270) { doc.addPage(); y = 20; }
        var dateStr = event.event_date ? new Date(event.event_date).toLocaleDateString('en-GB') : 'N/A';
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(dateStr + '  —  ' + event.title, 14, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.text('Type: ' + (EVENT_TYPES[event.event_type] || event.event_type), 14, y);
        y += 5;
        if (event.description) {
            var lines = doc.splitTextToSize(event.description, 170);
            doc.text(lines, 14, y);
            y += lines.length * 4 + 2;
        }
        y += 5;
    });

    doc.save('rentshield-timeline-' + formatDateForFilename() + '.pdf');
}


/* --------------------------------------------------------------------------
   18. AI Legal Letter Generator
   -------------------------------------------------------------------------- */

/** Letter type metadata (matches backend LETTER_TYPES) */
var LETTER_TYPES = {
    repair_request: { name: 'Repair Request', desc: 'Formal request to landlord to carry out repairs' },
    complaint: { name: 'Formal Complaint', desc: 'Formal complaint about landlord conduct or property condition' },
    notice_response: { name: 'Response to Notice', desc: 'Formal response to an eviction or rent increase notice' },
    deposit_demand: { name: 'Deposit Return Demand', desc: 'Demand for return of tenancy deposit' },
    disrepair_claim: { name: 'Disrepair Notification', desc: 'Notification of disrepair under Awaab\'s Law / Section 11' },
    rent_increase_challenge: { name: 'Rent Increase Challenge', desc: 'Challenge to an unfair or invalid rent increase' }
};

/**
 * Load and render the letter generator page.
 */
async function loadLettersPage() {
    var container = document.getElementById('letters-container');

    /* Fetch previously generated letters */
    var savedLetters = [];
    try {
        var response = await fetch('/api/letters', { headers: getAuthHeaders() });
        if (response.ok) savedLetters = await response.json();
    } catch (error) { /* Continue with empty */ }

    var typeOptions = Object.keys(LETTER_TYPES).map(function(key) {
        return '<option value="' + key + '">' + LETTER_TYPES[key].name + ' — ' + LETTER_TYPES[key].desc + '</option>';
    }).join('');

    var html =
        '<h2 class="ph">Legal Letter Generator</h2>' +
        '<p class="pp">Generate a formal legal letter citing the correct legislation for your situation. ' +
            'Review and personalize the letter before sending it to your landlord.</p>' +

        /* Generator form */
        '<div class="card">' +
            '<h4>Generate a Letter</h4>' +
            '<div class="fld">' +
                '<label>Letter Type</label>' +
                '<select class="inp" id="lt-type">' + typeOptions + '</select>' +
            '</div>' +
            '<div class="fld">' +
                '<label>Property Address</label>' +
                '<input class="inp" id="lt-addr" placeholder="Your property address">' +
            '</div>' +
            '<div class="fld">' +
                '<label>Describe Your Situation</label>' +
                '<textarea class="inp" id="lt-situation" rows="4" placeholder="Explain what happened, when it started, what you\'ve already tried, and what outcome you want..." style="resize:vertical;min-height:80px"></textarea>' +
            '</div>' +
            '<div class="fld">' +
                '<label>Additional Context (optional)</label>' +
                '<input class="inp" id="lt-context" placeholder="e.g. I have photos of the damage, I emailed them on 5 Jan...">' +
            '</div>' +
            '<button class="btn btn-p" id="lt-btn" onclick="generateLetter()">Generate Letter</button>' +
            '<div class="msg-t" id="lt-msg" role="alert"></div>' +
        '</div>' +

        /* Generated letter preview */
        '<div id="lt-preview" class="hidden">' +
            '<div class="sec">Generated Letter</div>' +
            '<div class="card letter-preview">' +
                '<div class="letter-actions">' +
                    '<button class="export-btn" onclick="exportLetterPdf()">Export PDF</button>' +
                    '<button class="btn btn-o btn-sm" onclick="copyLetterToClipboard()">Copy Text</button>' +
                '</div>' +
                '<div id="lt-content" class="letter-body"></div>' +
            '</div>' +
        '</div>';

    /* Saved letters */
    if (savedLetters.length) {
        html += '<div class="sec">Previous Letters (' + savedLetters.length + ')</div>';
        html += '<div class="grid">';
        savedLetters.forEach(function(letter) {
            var dateStr = letter.created_at ? new Date(letter.created_at).toLocaleDateString('en-GB') : '';
            html += '<div class="card">' +
                '<h4>' + (LETTER_TYPES[letter.letter_type] ? LETTER_TYPES[letter.letter_type].name : letter.letter_type) + '</h4>' +
                '<p>' + letter.situation.substring(0, 100) + (letter.situation.length > 100 ? '...' : '') + '</p>' +
                '<div class="meta">' + dateStr + '</div>' +
                '<div class="acts">' +
                    '<button class="btn btn-o btn-sm" onclick="viewSavedLetter(\'' + letter.letter_id + '\')">View</button>' +
                    '<button class="btn btn-d btn-sm" onclick="deleteLetter(\'' + letter.letter_id + '\')">Delete</button>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';
    }

    container.innerHTML = html;
}

/**
 * Generate a legal letter using the AI API.
 */
async function generateLetter() {
    var letterType = document.getElementById('lt-type').value;
    var address = document.getElementById('lt-addr').value.trim();
    var situation = document.getElementById('lt-situation').value.trim();
    var context = document.getElementById('lt-context').value.trim();
    var messageDisplay = document.getElementById('lt-msg');
    var submitButton = document.getElementById('lt-btn');

    if (!situation || situation.length < 10) {
        messageDisplay.textContent = 'Please describe your situation in detail (at least 10 characters).';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Generating letter...';
    messageDisplay.textContent = 'This may take 15-30 seconds...';
    messageDisplay.className = 'msg-t';

    try {
        var response = await fetch('/api/letters/generate', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                letter_type: letterType,
                property_address: address,
                situation: situation,
                additional_context: context
            })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Generation failed.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            submitButton.disabled = false;
            submitButton.textContent = 'Generate Letter';
            return;
        }

        var data = await response.json();
        messageDisplay.textContent = 'Letter generated successfully.';
        messageDisplay.className = 'msg-t msg-ok';

        /* Show the letter preview */
        var preview = document.getElementById('lt-preview');
        var contentDiv = document.getElementById('lt-content');
        contentDiv.innerHTML = formatMarkdown(data.content);
        preview.classList.remove('hidden');

        /* Scroll to the preview */
        preview.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        messageDisplay.textContent = 'Connection error. Please try again.';
        messageDisplay.className = 'msg-t msg-err';
    }

    submitButton.disabled = false;
    submitButton.textContent = 'Generate Letter';
}

/**
 * View a previously saved letter.
 * @param {string} letterId
 */
async function viewSavedLetter(letterId) {
    var letters = [];
    try {
        var response = await fetch('/api/letters', { headers: getAuthHeaders() });
        if (response.ok) letters = await response.json();
    } catch (error) { return; }

    var letter = letters.find(function(l) { return l.letter_id === letterId; });
    if (!letter) return;

    var preview = document.getElementById('lt-preview');
    var contentDiv = document.getElementById('lt-content');
    contentDiv.innerHTML = formatMarkdown(letter.content);
    preview.classList.remove('hidden');
    preview.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Delete a saved letter.
 * @param {string} letterId
 */
async function deleteLetter(letterId) {
    if (!confirm('Delete this letter?')) return;
    await fetch('/api/letters/' + letterId, { method: 'DELETE', headers: getAuthHeaders() });
    loadLettersPage();
}

/**
 * Copy the currently displayed letter text to clipboard.
 */
function copyLetterToClipboard() {
    var contentDiv = document.getElementById('lt-content');
    if (!contentDiv) return;

    var text = contentDiv.innerText || contentDiv.textContent;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        alert('Letter copied to clipboard.');
    } else {
        prompt('Copy the letter text:', text);
    }
}

/**
 * Export the currently displayed letter as a PDF.
 */
function exportLetterPdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    var contentDiv = document.getElementById('lt-content');
    if (!contentDiv || !contentDiv.textContent.trim()) {
        alert('No letter to export.');
        return;
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();

    var text = contentDiv.innerText || contentDiv.textContent;
    var lines = doc.splitTextToSize(text, 170);
    var y = 20;
    var pageHeight = 280;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');

    lines.forEach(function(line) {
        if (y > pageHeight) {
            doc.addPage();
            y = 20;
        }
        doc.text(line, 20, y);
        y += 5;
    });

    doc.save('rentshield-letter-' + formatDateForFilename() + '.pdf');
}


/* --------------------------------------------------------------------------
   19. Tenancy Agreement Analyzer
   -------------------------------------------------------------------------- */

/**
 * Load and render the agreement analyzer page.
 */
async function loadAgreementPage() {
    var container = document.getElementById('agreement-container');

    /* Fetch previous analyses */
    var history = [];
    try {
        var response = await fetch('/api/agreement/history', { headers: getAuthHeaders() });
        if (response.ok) history = await response.json();
    } catch (error) { /* Continue with empty */ }

    var html =
        '<h2 class="ph">Tenancy Agreement Analyzer</h2>' +
        '<p class="pp">Paste the text of your tenancy agreement below and the AI will flag ' +
            'unfair clauses, illegal terms (e.g. blanket pet bans, no-DSS), and missing required ' +
            'information under the Renters\' Rights Act 2025.</p>' +

        '<div class="card">' +
            '<h4>Paste Your Agreement</h4>' +
            '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px">' +
                'Copy and paste the full text (or key sections) of your tenancy agreement. ' +
                'The more text you provide, the better the analysis.</p>' +
            '<textarea class="inp" id="ag-text" rows="10" ' +
                'placeholder="Paste your tenancy agreement text here..." ' +
                'style="resize:vertical;min-height:150px;font-size:12px;line-height:1.6"></textarea>' +
            '<div style="display:flex;align-items:center;gap:10px;margin-top:8px">' +
                '<button class="btn btn-p" id="ag-btn" onclick="analyzeAgreement()">Analyze Agreement</button>' +
                '<span style="font-size:11px;color:var(--text-muted)" id="ag-chars">0 characters</span>' +
            '</div>' +
            '<div class="msg-t" id="ag-msg" role="alert"></div>' +
        '</div>' +

        /* Analysis result preview */
        '<div id="ag-preview" class="hidden">' +
            '<div class="sec">Analysis Results</div>' +
            '<div class="card">' +
                '<div class="letter-actions">' +
                    '<button class="export-btn" onclick="exportAgreementPdf()">Export PDF</button>' +
                '</div>' +
                '<div id="ag-content" class="analysis-body"></div>' +
            '</div>' +
        '</div>';

    /* Previous analyses */
    if (history.length) {
        html += '<div class="sec">Previous Analyses (' + history.length + ')</div>';
        history.forEach(function(item) {
            var dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-GB') : '';
            var preview = item.agreement_preview || '';
            html += '<div class="card">' +
                '<p style="font-size:12px;color:var(--text-secondary)">' +
                    preview.substring(0, 120) + (preview.length > 120 ? '...' : '') +
                '</p>' +
                '<div class="meta">' + dateStr + '</div>' +
                '<div class="acts">' +
                    '<button class="btn btn-o btn-sm" onclick="viewAnalysis(\'' + item.analysis_id + '\')">View</button>' +
                    '<button class="btn btn-d btn-sm" onclick="deleteAnalysis(\'' + item.analysis_id + '\')">Delete</button>' +
                '</div>' +
            '</div>';
        });
    }

    container.innerHTML = html;

    /* Character counter */
    var textArea = document.getElementById('ag-text');
    var charDisplay = document.getElementById('ag-chars');
    if (textArea && charDisplay) {
        textArea.addEventListener('input', function() {
            charDisplay.textContent = textArea.value.length.toLocaleString() + ' characters';
        });
    }
}

/**
 * Send the agreement text to the AI for analysis.
 */
async function analyzeAgreement() {
    var text = document.getElementById('ag-text').value.trim();
    var messageDisplay = document.getElementById('ag-msg');
    var submitButton = document.getElementById('ag-btn');

    if (text.length < 50) {
        messageDisplay.textContent = 'Please paste more text (at least 50 characters) for a useful analysis.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Analyzing...';
    messageDisplay.textContent = 'This may take 20-40 seconds. The AI is reviewing each clause...';
    messageDisplay.className = 'msg-t';

    try {
        var response = await fetch('/api/agreement/analyze', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ agreement_text: text })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Analysis failed.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            submitButton.disabled = false;
            submitButton.textContent = 'Analyze Agreement';
            return;
        }

        var data = await response.json();
        messageDisplay.textContent = 'Analysis complete.';
        messageDisplay.className = 'msg-t msg-ok';

        var preview = document.getElementById('ag-preview');
        var contentDiv = document.getElementById('ag-content');
        contentDiv.innerHTML = formatMarkdown(data.analysis);
        preview.classList.remove('hidden');
        preview.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        messageDisplay.textContent = 'Connection error. Please try again.';
        messageDisplay.className = 'msg-t msg-err';
    }

    submitButton.disabled = false;
    submitButton.textContent = 'Analyze Agreement';
}

/**
 * View a previous analysis by ID.
 * @param {string} analysisId
 */
async function viewAnalysis(analysisId) {
    var history = [];
    try {
        var response = await fetch('/api/agreement/history', { headers: getAuthHeaders() });
        if (response.ok) history = await response.json();
    } catch (error) { return; }

    var item = history.find(function(a) { return a.analysis_id === analysisId; });
    if (!item) return;

    var preview = document.getElementById('ag-preview');
    var contentDiv = document.getElementById('ag-content');
    contentDiv.innerHTML = formatMarkdown(item.analysis);
    preview.classList.remove('hidden');
    preview.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Delete a previous analysis.
 * @param {string} analysisId
 */
async function deleteAnalysis(analysisId) {
    if (!confirm('Delete this analysis?')) return;
    await fetch('/api/agreement/' + analysisId, { method: 'DELETE', headers: getAuthHeaders() });
    loadAgreementPage();
}

/**
 * Export the current agreement analysis as PDF.
 */
function exportAgreementPdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again.');
        return;
    }

    var contentDiv = document.getElementById('ag-content');
    if (!contentDiv || !contentDiv.textContent.trim()) {
        alert('No analysis to export.');
        return;
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();
    var text = contentDiv.innerText || contentDiv.textContent;
    var lines = doc.splitTextToSize(text, 170);
    var y = 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('RentShield - Agreement Analysis', 14, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB'), 14, y);
    doc.setTextColor(0);
    y += 8;
    doc.line(14, y, 196, y);
    y += 8;

    doc.setFontSize(10);
    lines.forEach(function(line) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, 14, y);
        y += 5;
    });

    doc.save('rentshield-agreement-analysis-' + formatDateForFilename() + '.pdf');
}


/* --------------------------------------------------------------------------
   20. Deposit Protection Checker
   -------------------------------------------------------------------------- */

/** UK deposit protection scheme details */
var DEPOSIT_SCHEMES = {
    dps: {
        name: 'Deposit Protection Service (DPS)',
        website: 'depositprotection.com',
        checkUrl: 'https://www.depositprotection.com/is-my-deposit-protected'
    },
    mydeposits: {
        name: 'Mydeposits',
        website: 'mydeposits.co.uk',
        checkUrl: 'https://www.mydeposits.co.uk/tenants/deposit-checker/'
    },
    tds: {
        name: 'Tenancy Deposit Scheme (TDS)',
        website: 'tenancydepositscheme.com',
        checkUrl: 'https://www.tenancydepositscheme.com/is-my-deposit-protected/'
    }
};

/**
 * Load and render the deposit checker page.
 */
async function loadDepositPage() {
    var container = document.getElementById('deposit-container');

    var history = [];
    try {
        var response = await fetch('/api/deposit/history', { headers: getAuthHeaders() });
        if (response.ok) history = await response.json();
    } catch (error) { /* Continue */ }

    var html =
        '<h2 class="ph">Deposit Protection Checker</h2>' +
        '<p class="pp">Check whether your deposit is protected with one of the three UK government-approved ' +
            'schemes. If it isn\'t, you may be entitled to compensation of 1-3x your deposit amount.</p>' +

        /* Quick links to check schemes directly */
        '<div class="card">' +
            '<h4>Check Directly with Each Scheme</h4>' +
            '<p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">' +
                'You can check each scheme\'s website directly to see if your deposit is registered:</p>' +
            '<div class="deposit-scheme-grid">';

    Object.keys(DEPOSIT_SCHEMES).forEach(function(key) {
        var scheme = DEPOSIT_SCHEMES[key];
        html += '<a href="' + scheme.checkUrl + '" target="_blank" rel="noopener" class="deposit-scheme-card">' +
                    '<strong>' + scheme.name + '</strong>' +
                    '<span>' + scheme.website + '</span>' +
                '</a>';
    });

    html += '</div></div>' +

        /* AI-powered deposit analysis */
        '<div class="card">' +
            '<h4>Get Personalized Guidance</h4>' +
            '<p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">' +
                'Enter your deposit details and the AI will analyze your situation and explain your rights.</p>' +
            '<div class="row">' +
                '<div class="fg"><label>Deposit Amount (&pound;)</label>' +
                    '<input class="inp" id="dp-amount" type="number" min="1" step="0.01" placeholder="e.g. 1200"></div>' +
                '<div class="fg"><label>Date Paid (approx.)</label>' +
                    '<input class="inp" id="dp-date" type="date"></div>' +
            '</div>' +
            '<div class="fld" style="margin-top:8px">' +
                '<label>Which scheme (if you know)?</label>' +
                '<select class="inp" id="dp-scheme">' +
                    '<option value="">I don\'t know</option>' +
                    '<option value="DPS">DPS</option>' +
                    '<option value="Mydeposits">Mydeposits</option>' +
                    '<option value="TDS">TDS</option>' +
                '</select>' +
            '</div>' +
            '<div class="fld">' +
                '<label class="chk-label"><input type="checkbox" id="dp-info"> ' +
                    'My landlord gave me a "prescribed information" document about the deposit</label>' +
            '</div>' +
            '<div class="fld">' +
                '<label>Additional Notes</label>' +
                '<input class="inp" id="dp-notes" placeholder="e.g. Landlord said they would protect it but never sent proof...">' +
            '</div>' +
            '<button class="btn btn-p" id="dp-btn" onclick="checkDeposit()">Check My Rights</button>' +
            '<div class="msg-t" id="dp-msg" role="alert"></div>' +
        '</div>' +

        /* Result preview */
        '<div id="dp-preview" class="hidden">' +
            '<div class="sec">Your Deposit Rights</div>' +
            '<div class="card">' +
                '<div class="letter-actions">' +
                    '<button class="export-btn" onclick="exportDepositPdf()">Export PDF</button>' +
                '</div>' +
                '<div id="dp-content" class="analysis-body"></div>' +
            '</div>' +
        '</div>';

    /* Previous checks */
    if (history.length) {
        html += '<div class="sec">Previous Checks (' + history.length + ')</div>';
        history.forEach(function(check) {
            var dateStr = check.created_at ? new Date(check.created_at).toLocaleDateString('en-GB') : '';
            html += '<div class="card">' +
                '<h4>&pound;' + check.deposit_amount + ' deposit</h4>' +
                '<div class="meta">' + dateStr + '</div>' +
                '<div class="acts">' +
                    '<button class="btn btn-o btn-sm" onclick="viewDepositCheck(\'' + check.check_id + '\')">View</button>' +
                '</div>' +
            '</div>';
        });
    }

    container.innerHTML = html;
}

/**
 * Submit deposit details for AI analysis.
 */
async function checkDeposit() {
    var amount = parseFloat(document.getElementById('dp-amount').value);
    var datePaid = document.getElementById('dp-date').value;
    var schemeName = document.getElementById('dp-scheme').value;
    var hasInfo = document.getElementById('dp-info').checked;
    var notes = document.getElementById('dp-notes').value.trim();
    var messageDisplay = document.getElementById('dp-msg');
    var submitButton = document.getElementById('dp-btn');

    if (!amount || amount <= 0) {
        messageDisplay.textContent = 'Enter your deposit amount.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Analyzing...';
    messageDisplay.textContent = 'Checking your rights — this may take 15-30 seconds...';
    messageDisplay.className = 'msg-t';

    try {
        var response = await fetch('/api/deposit/check', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                deposit_amount: amount,
                date_paid: datePaid,
                scheme_name: schemeName,
                has_prescribed_info: hasInfo,
                notes: notes
            })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Check failed.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            submitButton.disabled = false;
            submitButton.textContent = 'Check My Rights';
            return;
        }

        var data = await response.json();
        messageDisplay.textContent = 'Analysis complete.';
        messageDisplay.className = 'msg-t msg-ok';

        var preview = document.getElementById('dp-preview');
        var contentDiv = document.getElementById('dp-content');
        contentDiv.innerHTML = formatMarkdown(data.guidance);
        preview.classList.remove('hidden');
        preview.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        messageDisplay.textContent = 'Connection error. Please try again.';
        messageDisplay.className = 'msg-t msg-err';
    }

    submitButton.disabled = false;
    submitButton.textContent = 'Check My Rights';
}

/**
 * View a previous deposit check result.
 * @param {string} checkId
 */
async function viewDepositCheck(checkId) {
    var history = [];
    try {
        var response = await fetch('/api/deposit/history', { headers: getAuthHeaders() });
        if (response.ok) history = await response.json();
    } catch (error) { return; }

    var item = history.find(function(c) { return c.check_id === checkId; });
    if (!item) return;

    var preview = document.getElementById('dp-preview');
    var contentDiv = document.getElementById('dp-content');
    contentDiv.innerHTML = formatMarkdown(item.guidance);
    preview.classList.remove('hidden');
    preview.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Export deposit guidance as PDF.
 */
function exportDepositPdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading.');
        return;
    }

    var contentDiv = document.getElementById('dp-content');
    if (!contentDiv || !contentDiv.textContent.trim()) {
        alert('No guidance to export.');
        return;
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();
    var text = contentDiv.innerText || contentDiv.textContent;
    var lines = doc.splitTextToSize(text, 170);
    var y = 20;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('RentShield - Deposit Protection Check', 14, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB'), 14, y);
    doc.setTextColor(0);
    y += 8;
    doc.line(14, y, 196, y);
    y += 8;

    doc.setFontSize(10);
    lines.forEach(function(line) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(line, 14, y);
        y += 5;
    });

    doc.save('rentshield-deposit-check-' + formatDateForFilename() + '.pdf');
}


/* --------------------------------------------------------------------------
   21. Maintenance Requests
   -------------------------------------------------------------------------- */

/** Human-readable maintenance category labels */
var MAINTENANCE_CATEGORIES = {
    emergency: { name: 'Emergency', urgency: 'critical' },
    damp_mould: { name: 'Damp & Mould', urgency: 'high' },
    plumbing: { name: 'Plumbing', urgency: 'high' },
    electrical: { name: 'Electrical', urgency: 'high' },
    heating: { name: 'Heating & Hot Water', urgency: 'high' },
    structural: { name: 'Structural', urgency: 'medium' },
    pest_control: { name: 'Pest Control', urgency: 'medium' },
    appliance: { name: 'Appliance', urgency: 'low' },
    other: { name: 'Other', urgency: 'low' }
};

/** Status labels and badge classes */
var MAINTENANCE_STATUS = {
    reported: { label: 'Reported', badge: 'b-pending' },
    acknowledged: { label: 'Acknowledged', badge: 'b-pending' },
    in_progress: { label: 'In Progress', badge: 'b-pending' },
    completed: { label: 'Completed', badge: 'b-approved' },
    confirmed: { label: 'Confirmed', badge: 'b-approved' },
    escalated: { label: 'Escalated', badge: 'b-rejected' }
};

/** Urgency badge CSS class mapping */
var URGENCY_BADGE = {
    critical: 'b-rejected',
    high: 'b-pending',
    medium: 'b-pending',
    low: 'b-approved'
};

/**
 * Load the tenant's maintenance requests page.
 */
async function loadMaintenancePage() {
    var container = document.getElementById('maintenance-container');
    var requests = [];

    try {
        var response = await fetch('/api/maintenance', { headers: getAuthHeaders() });
        if (response.ok) requests = await response.json();
    } catch (error) { /* Continue */ }

    var categoryOptions = Object.keys(MAINTENANCE_CATEGORIES).map(function(key) {
        return '<option value="' + key + '">' + MAINTENANCE_CATEGORIES[key].name + '</option>';
    }).join('');

    var html =
        '<h2 class="ph">Maintenance Requests</h2>' +
        '<p class="pp">Report property issues to your landlord with a formal record. ' +
            'The system tracks Awaab\'s Law deadlines and flags when your landlord is overdue.</p>' +

        /* Report form */
        '<div class="card">' +
            '<h4>Report an Issue</h4>' +
            '<div class="row">' +
                '<div class="fg"><label>Category</label>' +
                    '<select class="inp" id="mt-cat">' + categoryOptions + '</select></div>' +
                '<div class="fg"><label>Location</label>' +
                    '<input class="inp" id="mt-loc" placeholder="e.g. Bathroom, Kitchen"></div>' +
            '</div>' +
            '<div class="fld" style="margin-top:8px">' +
                '<label>Description</label>' +
                '<textarea class="inp" id="mt-desc" rows="3" ' +
                    'placeholder="Describe the issue in detail — when did it start, how bad is it, has it worsened?" ' +
                    'style="resize:vertical;min-height:60px"></textarea>' +
            '</div>' +
            '<div class="fld">' +
                '<label>Photo (optional)</label>' +
                '<input type="file" id="mt-file" accept="image/*" class="inp">' +
            '</div>' +
            '<button class="btn btn-p" onclick="submitMaintenanceRequest()">Submit Request</button>' +
            '<div class="msg-t" id="mt-msg" role="alert"></div>' +
        '</div>';

    /* Existing requests */
    if (requests.length) {
        html += '<div class="sec">Your Requests (' + requests.length + ')</div>';
        requests.forEach(function(req) {
            html += buildMaintenanceCard(req, 'tenant');
        });
    } else {
        html += '<p class="empty" style="text-align:center;padding:20px">No maintenance requests yet.</p>';
    }

    container.innerHTML = html;
}

/**
 * Submit a new maintenance request.
 */
async function submitMaintenanceRequest() {
    var category = document.getElementById('mt-cat').value;
    var location = document.getElementById('mt-loc').value.trim();
    var description = document.getElementById('mt-desc').value.trim();
    var fileInput = document.getElementById('mt-file');
    var messageDisplay = document.getElementById('mt-msg');

    if (description.length < 10) {
        messageDisplay.textContent = 'Please describe the issue in more detail (at least 10 characters).';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    var formData = new FormData();
    formData.append('category', category);
    formData.append('location', location);
    formData.append('description', description);
    if (fileInput.files && fileInput.files[0]) {
        formData.append('file', fileInput.files[0]);
    }

    messageDisplay.textContent = 'Submitting...';
    messageDisplay.className = 'msg-t';

    try {
        var response = await fetch('/api/maintenance', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
            body: formData
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to submit.');
            messageDisplay.textContent = errMsg;
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Request submitted. Your landlord has been notified.';
        messageDisplay.className = 'msg-t msg-ok';
        document.getElementById('mt-desc').value = '';
        document.getElementById('mt-loc').value = '';
        fileInput.value = '';

        setTimeout(function() { loadMaintenancePage(); }, 500);
    } catch (error) {
        messageDisplay.textContent = 'Connection error.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/**
 * Build the HTML card for a single maintenance request.
 * @param {Object} req - The maintenance request object
 * @param {string} role - 'tenant' or 'landlord'
 * @returns {string} HTML string
 */
function buildMaintenanceCard(req, role) {
    var statusInfo = MAINTENANCE_STATUS[req.status] || { label: req.status, badge: 'b-pending' };
    var catInfo = MAINTENANCE_CATEGORIES[req.category] || { name: req.category, urgency: 'low' };
    var urgencyBadge = URGENCY_BADGE[catInfo.urgency] || 'b-pending';
    var reportedDate = req.reported_at ? new Date(req.reported_at).toLocaleDateString('en-GB') : '';
    var deadlineDate = req.deadline ? new Date(req.deadline).toLocaleDateString('en-GB') : '';

    var html = '<div class="card maint-card' + (req.is_overdue ? ' maint-overdue' : '') + '">' +
        '<div class="maint-header">' +
            '<div>' +
                '<span class="badge ' + urgencyBadge + '">' + catInfo.name + '</span> ' +
                '<span class="badge ' + statusInfo.badge + '">' + statusInfo.label + '</span>' +
                (req.is_overdue ? ' <span class="badge b-rejected">OVERDUE</span>' : '') +
            '</div>' +
            '<div class="meta">' + reportedDate + '</div>' +
        '</div>';

    if (req.location) {
        html += '<div class="meta" style="margin-bottom:4px">Location: ' + req.location + '</div>';
    }

    html += '<p>' + req.description + '</p>';

    if (req.photo_url) {
        html += '<img class="maint-photo" src="' + req.photo_url + '" alt="Issue photo">';
    }

    html += '<div class="maint-meta">' +
        '<span>Deadline: ' + deadlineDate + '</span>';

    if (req.landlord_response) {
        html += '<div class="maint-response">' +
            '<strong>Landlord response:</strong> ' + req.landlord_response +
        '</div>';
    }

    html += '</div>';

    /* Actions based on role and status */
    html += '<div class="acts">';
    if (role === 'tenant') {
        if (req.status === 'reported' || req.status === 'acknowledged') {
            html += '<button class="btn btn-d btn-sm" onclick="escalateRequest(\'' + req.request_id + '\')">Escalate</button>';
        }
        if (req.status === 'completed') {
            html += '<button class="btn btn-p btn-sm" onclick="confirmRepair(\'' + req.request_id + '\')">Confirm Repair</button>';
        }
    } else if (role === 'landlord') {
        if (req.status !== 'confirmed') {
            html += '<button class="btn btn-o btn-sm" onclick="showRespondForm(\'' + req.request_id + '\')">Respond</button>';
        }
    }
    html += '</div>';

    /* Inline respond form (hidden by default, for landlords) */
    if (role === 'landlord') {
        html += '<div id="respond-' + req.request_id + '" class="hidden maint-respond-form">' +
            '<textarea class="inp" id="resp-text-' + req.request_id + '" rows="2" placeholder="Your response..."></textarea>' +
            '<select class="inp" id="resp-status-' + req.request_id + '" style="margin-top:4px">' +
                '<option value="acknowledged">Acknowledge</option>' +
                '<option value="in_progress">Mark In Progress</option>' +
                '<option value="completed">Mark Completed</option>' +
            '</select>' +
            '<button class="btn btn-p btn-sm" style="margin-top:4px" ' +
                'onclick="respondToRequest(\'' + req.request_id + '\')">Send Response</button>' +
        '</div>';
    }

    html += '</div>';
    return html;
}

/**
 * Tenant escalates a maintenance request.
 * @param {string} requestId
 */
async function escalateRequest(requestId) {
    if (!confirm('Escalate this request? This flags it as unresolved past the legal deadline.')) return;
    await fetch('/api/maintenance/' + requestId + '/escalate', { method: 'POST', headers: getAuthHeaders() });
    loadMaintenancePage();
}

/**
 * Tenant confirms a repair is complete.
 * @param {string} requestId
 */
async function confirmRepair(requestId) {
    await fetch('/api/maintenance/' + requestId + '/confirm', { method: 'POST', headers: getAuthHeaders() });
    loadMaintenancePage();
}

/**
 * Show the inline respond form for a landlord.
 * @param {string} requestId
 */
function showRespondForm(requestId) {
    var form = document.getElementById('respond-' + requestId);
    if (form) form.classList.toggle('hidden');
}

/**
 * Landlord sends a response to a maintenance request.
 * @param {string} requestId
 */
async function respondToRequest(requestId) {
    var responseText = document.getElementById('resp-text-' + requestId).value.trim();
    var newStatus = document.getElementById('resp-status-' + requestId).value;

    if (!responseText) { alert('Enter a response.'); return; }

    try {
        var response = await fetch('/api/maintenance/' + requestId + '/respond', {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                response_text: responseText,
                new_status: newStatus
            })
        });

        if (response.ok) {
            loadLandlordMaintenance();
        } else {
            var errMsg = await getResponseError(response, 'Failed to respond.');
            alert(errMsg);
        }
    } catch (error) {
        alert('Connection error.');
    }
}

/**
 * Load the landlord's view of maintenance requests from their tenants.
 */
async function loadLandlordMaintenance() {
    var container = document.getElementById('ll-maint-container');
    var requests = [];

    try {
        var response = await fetch('/api/maintenance', { headers: getAuthHeaders() });
        if (response.ok) requests = await response.json();
    } catch (error) { /* Continue */ }

    var overdueCount = requests.filter(function(r) { return r.is_overdue; }).length;

    var html =
        '<h2 class="ph">Maintenance Requests</h2>' +
        '<p class="pp">Requests from your tenants. Respond promptly — ' +
            'Awaab\'s Law requires action within the stated deadlines.</p>';

    if (overdueCount > 0) {
        html += '<div class="card" style="background:var(--danger-bg);border-color:var(--danger)">' +
            '<strong style="color:var(--danger)">' + overdueCount +
            ' overdue request' + (overdueCount > 1 ? 's' : '') + '</strong>' +
            '<p style="font-size:12px;color:var(--danger)">These have passed their Awaab\'s Law deadline. ' +
                'Respond immediately to avoid legal consequences.</p>' +
        '</div>';
    }

    if (requests.length) {
        html += '<div class="sec">All Requests (' + requests.length + ')</div>';
        requests.forEach(function(req) {
            html += buildMaintenanceCard(req, 'landlord');
        });
    } else {
        html += '<p class="empty" style="text-align:center;padding:20px">No maintenance requests from tenants.</p>';
    }

    container.innerHTML = html;
}


/* --------------------------------------------------------------------------
   22. Password Management (Change & Reset)
   -------------------------------------------------------------------------- */

/** Show the password reset form on the auth screen. */
function showResetForm() {
    document.getElementById('reset-form').classList.remove('hidden');
    document.getElementById('reset-email').focus();
}

/** Hide the password reset form. */
function hideResetForm() {
    document.getElementById('reset-form').classList.add('hidden');
    document.getElementById('reset-err').textContent = '';
}

/**
 * Reset password using a token provided by admin/landlord.
 * Called from the auth screen reset form.
 */
async function resetPassword() {
    var email = document.getElementById('reset-email').value.trim();
    var resetToken = document.getElementById('reset-token').value.trim();
    var newPassword = document.getElementById('reset-new-pw').value;
    var errorDisplay = document.getElementById('reset-err');

    errorDisplay.textContent = '';

    if (!email || !resetToken || !newPassword) {
        errorDisplay.textContent = 'All fields are required.';
        return;
    }

    try {
        var response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: email,
                reset_token: resetToken,
                new_password: newPassword
            })
        });

        var data = await response.json();

        if (!response.ok) {
            errorDisplay.textContent = data.detail || 'Reset failed.';
            return;
        }

        errorDisplay.style.color = 'var(--success)';
        errorDisplay.textContent = data.message || 'Password reset. Please sign in.';
        document.getElementById('reset-token').value = '';
        document.getElementById('reset-new-pw').value = '';

        /* Auto-switch back to login after 2 seconds */
        setTimeout(function() {
            hideResetForm();
            errorDisplay.style.color = '';
            document.getElementById('a-email').value = email;
            document.getElementById('a-email').focus();
        }, 2000);
    } catch (error) {
        errorDisplay.textContent = 'Connection error.';
    }
}

/** Show the settings modal for password change. */
function showSettingsModal() {
    document.getElementById('settings-modal').classList.remove('hidden');
    document.getElementById('cp-cur').focus();
    document.getElementById('cp-msg').textContent = '';
}

/** Hide the settings modal. */
function hideSettingsModal() {
    document.getElementById('settings-modal').classList.add('hidden');
    document.getElementById('cp-cur').value = '';
    document.getElementById('cp-new').value = '';
    document.getElementById('cp-confirm').value = '';
    document.getElementById('cp-msg').textContent = '';
}

/**
 * Change the current user's password.
 * Validates confirmation match, then calls the API.
 */
async function changePassword() {
    var currentPw = document.getElementById('cp-cur').value;
    var newPw = document.getElementById('cp-new').value;
    var confirmPw = document.getElementById('cp-confirm').value;
    var messageDisplay = document.getElementById('cp-msg');

    messageDisplay.textContent = '';
    messageDisplay.className = 'msg-t';

    if (!currentPw || !newPw || !confirmPw) {
        messageDisplay.textContent = 'All fields are required.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    if (newPw !== confirmPw) {
        messageDisplay.textContent = 'New passwords do not match.';
        messageDisplay.className = 'msg-t msg-err';
        return;
    }

    try {
        var response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                current_password: currentPw,
                new_password: newPw
            })
        });

        var data = await response.json();

        if (!response.ok) {
            messageDisplay.textContent = data.detail || 'Password change failed.';
            messageDisplay.className = 'msg-t msg-err';
            return;
        }

        messageDisplay.textContent = 'Password changed. Logging out...';
        messageDisplay.className = 'msg-t msg-ok';

        /* Force re-login after password change */
        setTimeout(function() {
            hideSettingsModal();
            logout();
        }, 1500);
    } catch (error) {
        messageDisplay.textContent = 'Connection error.';
        messageDisplay.className = 'msg-t msg-err';
    }
}

/* Close settings modal on overlay click or Escape key */
document.addEventListener('click', function(event) {
    if (event.target.id === 'settings-modal') {
        hideSettingsModal();
    }
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        var modal = document.getElementById('settings-modal');
        if (modal && !modal.classList.contains('hidden')) {
            hideSettingsModal();
        }
    }
});


/* --------------------------------------------------------------------------
   17. PDF Export
   -------------------------------------------------------------------------- */

/**
 * Export chat conversation as a PDF document.
 * Collects all chat bubbles and formats them into a downloadable PDF.
 */
function exportChatPdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();

    /* Header */
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RentShield - Chat Conversation', 14, 20);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 107, 93);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB'), 14, 28);
    doc.text('Disclaimer: General legal information, not professional legal advice.', 14, 33);

    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 36, 196, 36);

    /* Collect chat messages */
    var bubbles = document.querySelectorAll('#feed .bubble');
    var yPosition = 44;
    var pageHeight = 280;

    bubbles.forEach(function(bubble) {
        var isUser = bubble.classList.contains('user');
        var sender = isUser ? 'You' : 'RentShield';
        var textContent = bubble.textContent
            .replace('Listen', '')
            .replace('Playing...', '')
            .replace('URGENT', '[URGENT] ')
            .trim();

        if (!textContent) return;

        /* Check if we need a new page */
        var lines = doc.splitTextToSize(textContent, 160);
        var blockHeight = lines.length * 5 + 10;

        if (yPosition + blockHeight > pageHeight) {
            doc.addPage();
            yPosition = 20;
        }

        /* Sender label */
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(isUser ? 59 : 119, isUser ? 50 : 107, isUser ? 40 : 93);
        doc.text(sender + ':', 14, yPosition);
        yPosition += 5;

        /* Message text */
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
        doc.text(lines, 14, yPosition);
        yPosition += lines.length * 5 + 6;
    });

    if (bubbles.length === 0) {
        doc.setFontSize(11);
        doc.text('No messages in this conversation.', 14, yPosition);
    }

    doc.save('rentshield-chat-' + formatDateForFilename() + '.pdf');
}

/**
 * Export notice analysis as a PDF document.
 */
function exportNoticePdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    var resultBody = document.getElementById('ncon');
    if (!resultBody || !resultBody.textContent.trim()) {
        alert('No notice analysis to export. Analyze a notice first.');
        return;
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();

    /* Header */
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RentShield - Notice Analysis', 14, 20);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 107, 93);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB'), 14, 28);
    doc.text('Disclaimer: General legal information, not professional legal advice.', 14, 33);

    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 36, 196, 36);

    /* Original notice */
    var noticeInput = document.getElementById('nta');
    if (noticeInput && noticeInput.value.trim()) {
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Original Notice:', 14, 44);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        var noticeLines = doc.splitTextToSize(noticeInput.value.trim(), 170);
        doc.text(noticeLines, 14, 52);
        var nextY = 52 + noticeLines.length * 5 + 8;

        doc.line(14, nextY, 196, nextY);
        nextY += 8;

        /* Analysis */
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Legal Analysis:', 14, nextY);
        nextY += 8;

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        var analysisText = resultBody.textContent.trim();
        var analysisLines = doc.splitTextToSize(analysisText, 170);

        /* Handle multi-page analysis */
        var pageHeight = 280;
        analysisLines.forEach(function(line) {
            if (nextY > pageHeight) {
                doc.addPage();
                nextY = 20;
            }
            doc.text(line, 14, nextY);
            nextY += 5;
        });
    }

    doc.save('rentshield-notice-analysis-' + formatDateForFilename() + '.pdf');
}

/**
 * Export wellbeing journal history as a PDF document.
 */
async function exportWellbeingPdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    if (!sessionId) {
        alert('No journal entries to export.');
        return;
    }

    /* Fetch full history */
    var entries = [];
    try {
        var response = await fetch('/api/wellbeing/history/' + sessionId);
        if (response.ok) {
            var data = await response.json();
            entries = data.entries || [];
        }
    } catch (error) {
        /* Continue with empty */
    }

    if (!entries.length) {
        alert('No journal entries to export.');
        return;
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF();

    /* Header */
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RentShield - Wellbeing Journal', 14, 20);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 107, 93);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB'), 14, 28);
    doc.text(entries.length + ' entries | This document may serve as timestamped evidence.', 14, 33);

    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 36, 196, 36);

    var yPosition = 44;
    var pageHeight = 280;

    entries.forEach(function(entry, index) {
        var blockHeight = 30;
        if (entry.journal_text) blockHeight += 10;
        if (entry.ai_prompt) blockHeight += 10;

        if (yPosition + blockHeight > pageHeight) {
            doc.addPage();
            yPosition = 20;
        }

        /* Entry header */
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        var dateStr = entry.created_at ? new Date(entry.created_at).toLocaleString('en-GB') : 'Unknown date';
        var moodLabel = MOOD_LABELS[entry.mood] || 'Unknown';
        doc.text('Entry ' + (index + 1) + ' — ' + dateStr, 14, yPosition);
        yPosition += 6;

        doc.setFont('helvetica', 'normal');
        doc.text('Mood: ' + entry.mood + '/5 (' + moodLabel + ')', 14, yPosition);
        yPosition += 6;

        /* Journal text */
        if (entry.journal_text) {
            var journalLines = doc.splitTextToSize('Notes: ' + entry.journal_text, 170);
            doc.text(journalLines, 14, yPosition);
            yPosition += journalLines.length * 5 + 2;
        }

        /* AI response */
        if (entry.ai_prompt) {
            doc.setTextColor(100, 100, 100);
            var promptLines = doc.splitTextToSize('AI Prompt: ' + entry.ai_prompt, 170);
            doc.text(promptLines, 14, yPosition);
            yPosition += promptLines.length * 5 + 2;
            doc.setTextColor(0, 0, 0);
        }

        /* Separator */
        doc.setDrawColor(220, 220, 220);
        doc.line(14, yPosition, 196, yPosition);
        yPosition += 6;
    });

    doc.save('rentshield-wellbeing-journal-' + formatDateForFilename() + '.pdf');
}

/**
 * Format today's date for use in filenames (YYYY-MM-DD).
 * @returns {string} Date string like '2026-02-13'
 */
function formatDateForFilename() {
    var now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}


/* --------------------------------------------------------------------------
   18. ARIA State Management
   -------------------------------------------------------------------------- */

/**
 * Update ARIA attributes when switching role tabs on the auth screen.
 * @param {string} role - The selected role
 */
function updateRoleTabAria(role) {
    var tabs = document.querySelectorAll('#a-tabs button');
    tabs.forEach(function(tab) {
        tab.setAttribute('aria-selected', 'false');
    });
    var roleIndex = ['tenant', 'landlord', 'admin'].indexOf(role);
    if (tabs[roleIndex]) {
        tabs[roleIndex].setAttribute('aria-selected', 'true');
    }
}


/* --------------------------------------------------------------------------
   19. Auto-boot (resume session if token exists)
   -------------------------------------------------------------------------- */

if (authToken && currentUser) {
    boot();
}
