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

/** Current language code (default: English) */
var currentLang = localStorage.getItem('rs_lang') || 'en';

/** Loaded translation strings for the current language */
var i18nStrings = {};

/** English fallback strings (loaded once) */
var i18nFallback = {};

/** Available languages with display names */
var LANGUAGES = {
    en: 'English',
    pl: 'Polski',
    ro: 'Română',
    bn: 'বাংলা',
    ur: 'اردو',
    ar: 'العربية'
};

/** RTL languages */
var RTL_LANGUAGES = ['ar', 'ur'];


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
 * Escape HTML special characters to prevent XSS when inserting into innerHTML.
 * @param {string} str - The untrusted string to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
   3b. Dark Mode
   -------------------------------------------------------------------------- */

/**
 * Toggle between light and dark mode. Persists preference to localStorage.
 */
function toggleDarkMode() {
    var html = document.documentElement;
    var isDark = html.getAttribute('data-theme') === 'dark';
    var newTheme = isDark ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('rs_theme', newTheme);
    updateDarkModeButtons(newTheme);
}

/**
 * Update all dark mode toggle button labels to reflect current theme.
 * @param {string} theme - Current theme ('light' or 'dark')
 */
function updateDarkModeButtons(theme) {
    var label = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    var headerBtn = document.getElementById('theme-toggle');
    var authBtn = document.getElementById('theme-toggle-auth');
    if (headerBtn) headerBtn.textContent = label;
    if (authBtn) authBtn.textContent = label;
}

/**
 * Apply saved theme preference on page load.
 * Respects system preference if no explicit choice was saved.
 */
function applyTheme() {
    var saved = localStorage.getItem('rs_theme');
    if (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        saved = 'dark';
    }
    var theme = saved || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    updateDarkModeButtons(theme);
}

/* Apply theme immediately so button labels are correct on load */
applyTheme();


/* --------------------------------------------------------------------------
   3c. Accessibility Helpers
   -------------------------------------------------------------------------- */

/**
 * Announce a message to screen readers via a live region.
 * Creates a temporary element that is read aloud then removed.
 * @param {string} message - Text to announce
 */
function announceToScreenReader(message) {
    var el = document.getElementById('sr-announce');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sr-announce';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        el.className = 'sr-only';
        document.body.appendChild(el);
    }
    /* Clear then set to trigger re-announcement */
    el.textContent = '';
    setTimeout(function() { el.textContent = message; }, 100);
}

/**
 * Set up keyboard navigation for the sidebar nav.
 * Arrow keys move between nav buttons, Enter/Space activates.
 */
function initNavKeyboard() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    nav.addEventListener('keydown', function(e) {
        var buttons = Array.from(nav.querySelectorAll('.n-btn'));
        var idx = buttons.indexOf(document.activeElement);
        if (idx === -1) return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            e.preventDefault();
            var next = idx < buttons.length - 1 ? idx + 1 : 0;
            buttons[next].focus();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            e.preventDefault();
            var prev = idx > 0 ? idx - 1 : buttons.length - 1;
            buttons[prev].focus();
        }
    });
}


/* --------------------------------------------------------------------------
   3d. Internationalization (i18n)
   -------------------------------------------------------------------------- */

/**
 * Load translation strings for a given language.
 * Fetches the JSON file from /static/i18n/{lang}.json.
 * Falls back to English for any missing keys.
 * @param {string} lang - Language code (en, pl, ro, bn, ur, ar)
 */
async function loadLanguage(lang) {
    try {
        var response = await fetch('/static/i18n/' + lang + '.json');
        if (response.ok) {
            i18nStrings = await response.json();
        } else {
            i18nStrings = {};
        }
    } catch (e) {
        i18nStrings = {};
    }

    /* Load English fallback if not already loaded and not English */
    if (lang !== 'en' && Object.keys(i18nFallback).length === 0) {
        try {
            var enResponse = await fetch('/static/i18n/en.json');
            if (enResponse.ok) i18nFallback = await enResponse.json();
        } catch (e) { /* ignore */ }
    }

    /* If English was selected, use it as both primary and fallback */
    if (lang === 'en') {
        i18nFallback = i18nStrings;
    }

    currentLang = lang;
    localStorage.setItem('rs_lang', lang);

    /* Apply RTL direction for Arabic and Urdu */
    if (RTL_LANGUAGES.indexOf(lang) >= 0) {
        document.documentElement.setAttribute('dir', 'rtl');
    } else {
        document.documentElement.removeAttribute('dir');
    }

    updateLanguagePickers();
}

/**
 * Get a translated string by key.
 * Returns the translation for the current language, or falls back to English.
 * If key not found in either, returns the key itself.
 * @param {string} key - Translation key
 * @returns {string}
 */
function t(key) {
    return i18nStrings[key] || i18nFallback[key] || key;
}

/**
 * Switch the application language. Reloads translations and re-renders
 * the current page to apply the new language.
 * @param {string} lang - Language code
 */
async function switchLanguage(lang) {
    await loadLanguage(lang);

    /* Update static elements in the HTML */
    updateStaticTranslations();

    /* Re-initialize the current role view to apply translations */
    if (currentUser) {
        if (currentUser.role === 'tenant') initTenant();
        else if (currentUser.role === 'landlord') initLandlord();
        else if (currentUser.role === 'admin') initAdmin();
    }
}

/**
 * Update static HTML elements with translated text.
 * These are elements in index.html that don't get re-rendered by JS.
 */
function updateStaticTranslations() {
    /* Header bar */
    var settingsBtn = document.querySelector('.bar-out[onclick="showSettingsModal()"]');
    if (settingsBtn) settingsBtn.textContent = t('settings');

    var signOutBtn = document.querySelector('.bar-out[onclick="logout()"]');
    if (signOutBtn) signOutBtn.textContent = t('sign_out');

    /* Settings modal */
    var settingsTitle = document.querySelector('#settings-modal h3');
    if (settingsTitle) settingsTitle.textContent = t('account_settings');
}

/**
 * Update all language picker dropdowns to reflect the current language.
 */
function updateLanguagePickers() {
    var pickers = document.querySelectorAll('.lang-picker');
    pickers.forEach(function(picker) {
        picker.value = currentLang;
    });
}

/**
 * Build HTML for a language picker dropdown.
 * @param {string} extraClass - Optional additional CSS class
 * @returns {string} HTML string for the select element
 */
function buildLanguagePicker(extraClass) {
    var cls = 'lang-picker' + (extraClass ? ' ' + extraClass : '');
    var html = '<select class="' + cls + '" onchange="switchLanguage(this.value)" aria-label="Language">';
    var keys = Object.keys(LANGUAGES);
    keys.forEach(function(code) {
        var selected = code === currentLang ? ' selected' : '';
        html += '<option value="' + code + '"' + selected + '>' + LANGUAGES[code] + '</option>';
    });
    html += '</select>';
    return html;
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
    // Revoke token server-side before clearing local state
    if (authToken) {
        fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
        }).catch(() => {});
    }
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

    initNavKeyboard();
    loadNotifications();

    // Poll for new notifications every 60 seconds
    if (window._notifInterval) clearInterval(window._notifInterval);
    window._notifInterval = setInterval(loadNotifications, 60000);
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
    if (pageId === 'll-compliance') loadCompliance();
    if (pageId === 'admin-analytics') loadAdminAnalytics();
    if (pageId === 'knowledge') loadKnowledgeBase();
    if (pageId === 'home' || pageId === 'll-home') loadDashboard();
    if (pageId === 'notice-calc') loadNoticeCalculator();
    if (pageId === 'local-help') loadLocalHelp();
    if (pageId === 'case-export') loadCaseExport();
    if (pageId === 'quiz') loadQuiz();
    if (pageId === 'scenarios') loadScenarios();
    if (pageId === 'rent-compare') loadRentComparator();
    if (pageId === 'dispute-assess') loadDisputeAssessor();
    if (pageId === 'vault') loadDocumentVault();
    if (pageId === 'deadlines') loadDeadlines();
    if (pageId === 'messages') loadMessages();
    if (pageId === 'emergency') loadEmergencyPage();
    if (pageId === 'll-reminders') loadReminders();
    if (pageId === 'll-reputation') loadReputation();

    /* Announce page change to screen readers */
    if (navButton) announceToScreenReader('Navigated to ' + navButton.textContent);

    /* Focus the first heading on the new page for keyboard users */
    if (pageElement) {
        var heading = pageElement.querySelector('.ph, h2, h3');
        if (heading) {
            heading.setAttribute('tabindex', '-1');
            heading.focus();
        }
    }
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
                '<div class="chat-feed" id="feed" aria-live="polite" aria-label="Chat messages">' +
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
        { t: 'Dashboard', pg: 'home' },
        { sep: 1 },
        { lbl: 'Legal Tools' },
        { t: 'AI Chat', pg: 'chat' },
        { t: 'Notice Checker', pg: 'notice' },
        { t: 'Notice Calculator', pg: 'notice-calc' },
        { t: 'Knowledge Base', pg: 'knowledge' },
        { t: 'Rights Quiz', pg: 'quiz' },
        { t: 'Scenario Simulator', pg: 'scenarios' },
        { t: 'Letter Generator', pg: 'letters' },
        { t: 'Agreement Analyzer', pg: 'agreement' },
        { t: 'Deposit Checker', pg: 'deposit' },
        { t: 'Rent Comparator', pg: 'rent-compare' },
        { sep: 1 },
        { lbl: 'My Case' },
        { t: 'Case Strength', pg: 'dispute-assess' },
        { t: 'Evidence Locker', pg: 'evidence' },
        { t: 'Document Vault', pg: 'vault' },
        { t: 'Dispute Timeline', pg: 'timeline' },
        { t: 'Maintenance', pg: 'maintenance' },
        { t: 'Deadlines', pg: 'deadlines' },
        { t: 'Messages', pg: 'messages' },
        { t: 'Export Case File', pg: 'case-export' },
        { sep: 1 },
        { lbl: 'Wellbeing' },
        { t: 'Journal', pg: 'wellbeing' },
        { t: 'Rewards', pg: 'rewards' },
        { sep: 1 },
        { lbl: 'Support' },
        { t: 'Emergency', pg: 'emergency' },
        { t: 'Local Help', pg: 'local-help' },
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
        '<div class="pg on" id="pg-home"><div class="ps" id="dashboard-container"><p class="empty">Loading dashboard...</p></div></div>' +
        '<div class="pg" id="pg-chat">' + chatHtml + '</div>' +
        '<div class="pg" id="pg-notice">' + noticeHtml + '</div>' +
        '<div class="pg" id="pg-notice-calc"><div class="ps" id="notice-calc-container"></div></div>' +
        '<div class="pg" id="pg-local-help"><div class="ps" id="local-help-container"></div></div>' +
        '<div class="pg" id="pg-case-export"><div class="ps" id="case-export-container"></div></div>' +
        '<div class="pg" id="pg-knowledge"><div class="ps" id="knowledge-container"><p class="empty">Loading...</p></div></div>' +
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
        '</div>' +

        /* Rights Quiz page */
        '<div class="pg" id="pg-quiz">' +
            '<div class="ps" id="quiz-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Scenario Simulator page */
        '<div class="pg" id="pg-scenarios">' +
            '<div class="ps" id="scenarios-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Rent Comparator page */
        '<div class="pg" id="pg-rent-compare">' +
            '<div class="ps" id="rent-compare-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Dispute Strength Assessor page */
        '<div class="pg" id="pg-dispute-assess">' +
            '<div class="ps" id="dispute-assess-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Document Vault page */
        '<div class="pg" id="pg-vault">' +
            '<div class="ps" id="vault-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Deadline Tracker page */
        '<div class="pg" id="pg-deadlines">' +
            '<div class="ps" id="deadlines-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Messages page */
        '<div class="pg" id="pg-messages">' +
            '<div class="ps" id="messages-container"><p class="empty">Loading...</p></div>' +
        '</div>' +

        /* Emergency Panic Button page */
        '<div class="pg" id="pg-emergency">' +
            '<div class="ps" id="emergency-container"><p class="empty">Loading...</p></div>' +
        '</div>';

    loadAnalytics();
}

/** Initialize the landlord dashboard with all pages. */
function initLandlord() {
    setNav([
        { t: 'Dashboard', pg: 'll-home' },
        { sep: 1 },
        { lbl: 'Manage' },
        { t: 'Tenants', pg: 'll-tenants' },
        { t: 'Tasks', pg: 'll-tasks' },
        { t: 'Perks', pg: 'll-perks' },
        { t: 'Maintenance', pg: 'll-maintenance' },
        { t: 'Compliance', pg: 'll-compliance' },
        { t: 'Reminders', pg: 'll-reminders' },
        { t: 'Messages', pg: 'messages' },
        { sep: 1 },
        { lbl: 'Legal Tools' },
        { t: 'AI Chat', pg: 'chat' },
        { t: 'Notice Checker', pg: 'notice' },
        { t: 'Knowledge Base', pg: 'knowledge' },
        { t: 'Rights Quiz', pg: 'quiz' },
        { t: 'Document Vault', pg: 'vault' },
        { t: 'Deadlines', pg: 'deadlines' },
        { t: 'Reputation', pg: 'll-reputation' }
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
        '<div class="pg on" id="pg-ll-home"><div class="ps" id="dashboard-container"><p class="empty">Loading dashboard...</p></div></div>' +
        '<div class="pg" id="pg-ll-tenants"><div class="ps" id="lltb"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-ll-tasks"><div class="ps" id="lltkb"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-ll-perks"><div class="ps" id="llpb"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-chat">' + chatHtml + '</div>' +
        '<div class="pg" id="pg-notice">' + noticeHtml + '</div>' +
        '<div class="pg" id="pg-ll-maintenance"><div class="ps" id="ll-maint-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-ll-compliance"><div class="ps" id="compliance-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-knowledge"><div class="ps" id="knowledge-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-ll-reminders"><div class="ps" id="reminders-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-messages"><div class="ps" id="messages-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-quiz"><div class="ps" id="quiz-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-vault"><div class="ps" id="vault-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-deadlines"><div class="ps" id="deadlines-container"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-ll-reputation"><div class="ps" id="reputation-container"><p class="empty">Loading...</p></div></div>';

    loadDashboard();
}

/** Initialize the admin dashboard. */
function initAdmin() {
    setNav([
        { lbl: 'Admin' },
        { t: 'Landlords', pg: 'admin-ll' },
        { t: 'Analytics', pg: 'admin-analytics' }
    ]);
    document.getElementById('pw').innerHTML =
        '<div class="pg on" id="pg-admin-ll"><div class="ps" id="allb"><p class="empty">Loading...</p></div></div>' +
        '<div class="pg" id="pg-admin-analytics"><div class="ps" id="admin-analytics-container"><p class="empty">Loading...</p></div></div>';
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
                user_type: userType,
                language: currentLang
            })
        });

        if (!response.ok) throw new Error('Chat request failed');

        var data = await response.json();
        sessionId = data.session_id;

        /* Hide typing indicator and show bot response */
        document.getElementById('dots').classList.add('hidden');
        addChatBubble(data.response, 'bot', data.urgency, data.sources, data.confidence, data.disclaimer);

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
        updateConversationMemory(data.detected_issue, data.urgency);

        /* Show smart action suggestions based on detected issue */
        var actionSuggestions = buildActionSuggestions(data.detected_issue);
        if (actionSuggestions) {
            var feed = document.getElementById('feed');
            feed.appendChild(actionSuggestions);
            feed.scrollTop = feed.scrollHeight;
        }

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
 * @param {Array} [sources] - Optional array of source citations [{title, url}]
 * @param {string} [confidence] - Optional confidence level ('high', 'medium', 'low')
 * @param {string} [disclaimer] - Optional legal disclaimer text
 */
function addChatBubble(text, type, urgency, sources, confidence, disclaimer) {
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
    if (type === 'bot') {
        content.innerHTML = formatMarkdown(text);
    } else {
        content.textContent = text;
    }
    bubble.appendChild(content);

    /* Add sources and confidence for bot messages */
    if (type === 'bot' && sources && sources.length > 0) {
        var sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'chat-sources';

        /* Confidence badge */
        var badge = document.createElement('span');
        badge.className = 'confidence-badge confidence-' + (confidence || 'medium');
        badge.textContent = (confidence || 'medium').toUpperCase() + ' CONFIDENCE';
        sourcesDiv.appendChild(badge);

        /* Source links */
        var sourcesList = document.createElement('div');
        sourcesList.className = 'sources-list';
        var sourcesLabel = document.createElement('span');
        sourcesLabel.className = 'sources-label';
        sourcesLabel.textContent = 'Sources: ';
        sourcesList.appendChild(sourcesLabel);

        for (var i = 0; i < sources.length; i++) {
            var link = document.createElement('a');
            link.href = sources[i].url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'source-link';
            link.textContent = sources[i].title;
            sourcesList.appendChild(link);
            if (i < sources.length - 1) {
                sourcesList.appendChild(document.createTextNode(' | '));
            }
        }

        sourcesDiv.appendChild(sourcesList);
        bubble.appendChild(sourcesDiv);
    }

    /* Add disclaimer for bot messages */
    if (type === 'bot' && disclaimer) {
        var disclaimerDiv = document.createElement('div');
        disclaimerDiv.className = 'chat-disclaimer';
        disclaimerDiv.textContent = disclaimer;
        bubble.appendChild(disclaimerDiv);
    }

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
 * Build smart action suggestion buttons based on detected issue type.
 * Links users to existing features relevant to their situation.
 * @param {string} detectedIssue - Issue type from the API response
 * @returns {HTMLElement|null} Action buttons container, or null if none
 */
function buildActionSuggestions(detectedIssue) {
    var suggestions = {
        'illegal_eviction': [
            { label: 'Collect Evidence', page: 'evidence', icon: '📁' },
            { label: 'Log in Timeline', page: 'timeline', icon: '📅' },
            { label: 'Generate Letter', page: 'letters', icon: '✉️' },
            { label: 'Find Local Help', page: 'local-help', icon: '📍' },
        ],
        'eviction': [
            { label: 'Check Notice Validity', page: 'notice-calc', icon: '📋' },
            { label: 'Collect Evidence', page: 'evidence', icon: '📁' },
            { label: 'Generate Letter', page: 'letters', icon: '✉️' },
        ],
        'deposit': [
            { label: 'Check Deposit Protection', page: 'deposit', icon: '🛡️' },
            { label: 'Generate Letter', page: 'letters', icon: '✉️' },
        ],
        'repairs': [
            { label: 'Report Maintenance', page: 'maintenance', icon: '🔧' },
            { label: 'Collect Evidence', page: 'evidence', icon: '📁' },
            { label: 'Generate Letter', page: 'letters', icon: '✉️' },
        ],
        'rent_increase': [
            { label: 'Check Notice Validity', page: 'notice-calc', icon: '📋' },
            { label: 'Find Local Help', page: 'local-help', icon: '📍' },
        ],
        'discrimination': [
            { label: 'Collect Evidence', page: 'evidence', icon: '📁' },
            { label: 'Log in Timeline', page: 'timeline', icon: '📅' },
            { label: 'Find Local Help', page: 'local-help', icon: '📍' },
        ],
    };

    var actions = suggestions[detectedIssue];
    if (!actions || actions.length === 0) return null;

    var container = document.createElement('div');
    container.className = 'action-suggestions';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Suggested next steps');

    var label = document.createElement('div');
    label.className = 'action-suggestions-label';
    label.textContent = 'Suggested next steps:';
    container.appendChild(label);

    var btnGroup = document.createElement('div');
    btnGroup.className = 'action-suggestions-buttons';

    actions.forEach(function(action) {
        var btn = document.createElement('button');
        btn.className = 'action-suggestion-btn';
        btn.textContent = action.icon + ' ' + action.label;
        btn.onclick = function() { navigateTo(action.page); };
        btnGroup.appendChild(btn);
    });

    container.appendChild(btnGroup);
    return container;
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
            body: JSON.stringify({ notice_text: noticeText, session_id: sessionId, language: currentLang })
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
                    '<div class="b-icon">' + escapeHtml(badge.name.charAt(0)) + '</div>' +
                    '<div class="b-name">' + escapeHtml(badge.name) + '</div>' +
                    '<div class="b-desc">' + escapeHtml(badge.description) + '</div>' +
                '</div>';
            }).join('');
        }

        /* Render vouchers */
        var voucherContainer = document.getElementById('rv');
        if (voucherContainer && (data.vouchers || []).length) {
            voucherContainer.innerHTML = data.vouchers.map(function(voucher) {
                return '<div class="card"><h4 style="color:var(--success)">' + escapeHtml(voucher.title || 'Voucher') +
                    '</h4><p>' + escapeHtml(voucher.description || '') + '</p></div>';
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
                            '<h4>' + escapeHtml(tenant.name) + '</h4>' +
                            '<p>' + escapeHtml(tenant.email) + '</p>' +
                            '<div class="meta">' + escapeHtml(tenant.property_address || 'No address') + ' &middot; ' + (tenant.points || 0) + ' pts</div>' +
                            '<div class="acts">' +
                                '<button class="btn btn-o btn-sm" onclick="generateResetToken(\'' + escapeHtml(tenant.email) + '\')">Reset Password</button>' +
                                '<button class="btn btn-d btn-sm" onclick="removeTenant(\'' + escapeHtml(tenant.user_id) + '\')">Remove</button>' +
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

        /* Upload mode toggle */
        '<div class="guided-capture-toggle">' +
            '<button id="ev-mode-quick" class="active" onclick="switchEvidenceMode(\'quick\')">Quick Upload</button>' +
            '<button id="ev-mode-guided" onclick="switchEvidenceMode(\'guided\')">Guided Capture</button>' +
        '</div>' +

        /* Quick upload form */
        '<div class="card" id="ev-quick-form">' +
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
        '</div>' +

        /* Guided capture wizard */
        '<div class="card" id="ev-guided-form" style="display:none">' +
            '<h4>Guided Evidence Capture</h4>' +
            '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">' +
                'Select your issue type below and we\'ll generate a checklist of exactly what evidence to collect.</p>' +
            '<div class="guided-issue-grid" id="ev-issue-grid"></div>' +
            '<div id="ev-guide-content"></div>' +
            '<div class="msg-t" id="ev-guide-msg" role="alert"></div>' +
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
    renderIssueTypeGrid();
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
   16b. Guided Evidence Capture
   -------------------------------------------------------------------------- */

/** Issue types available for guided capture with labels and icons */
var GUIDED_ISSUE_TYPES = {
    mould_damp:       { label: 'Mould & Damp',    icon: '💧' },
    lock_change:      { label: 'Lock Change',      icon: '🔒' },
    property_damage:  { label: 'Disrepair',        icon: '🏚' },
    harassment:       { label: 'Harassment',        icon: '⚠' },
    rent_dispute:     { label: 'Rent Dispute',      icon: '💷' }
};

/** Currently selected issue type for guided capture */
var guidedIssueType = '';

/** Current guide data from the API */
var currentGuide = null;

/** Tracks which checklist items have been uploaded (by index) */
var guidedUploaded = {};

/**
 * Switch between quick upload and guided capture modes.
 * @param {string} mode - 'quick' or 'guided'
 */
function switchEvidenceMode(mode) {
    var quickForm = document.getElementById('ev-quick-form');
    var guidedForm = document.getElementById('ev-guided-form');
    var quickBtn = document.getElementById('ev-mode-quick');
    var guidedBtn = document.getElementById('ev-mode-guided');

    if (mode === 'guided') {
        quickForm.style.display = 'none';
        guidedForm.style.display = 'block';
        quickBtn.classList.remove('active');
        guidedBtn.classList.add('active');
    } else {
        quickForm.style.display = 'block';
        guidedForm.style.display = 'none';
        quickBtn.classList.add('active');
        guidedBtn.classList.remove('active');
    }
}

/**
 * Render the issue type selection grid inside the guided capture form.
 */
function renderIssueTypeGrid() {
    var grid = document.getElementById('ev-issue-grid');
    if (!grid) return;

    var html = '';
    var keys = Object.keys(GUIDED_ISSUE_TYPES);
    keys.forEach(function(key) {
        var issue = GUIDED_ISSUE_TYPES[key];
        var selectedClass = key === guidedIssueType ? ' selected' : '';
        html += '<button class="guided-issue-btn' + selectedClass + '" onclick="selectGuidedIssue(\'' + key + '\')">' +
            '<span class="issue-icon">' + issue.icon + '</span>' +
            issue.label +
        '</button>';
    });

    /* Add "Other" option for AI-generated guidance */
    html += '<button class="guided-issue-btn' + (guidedIssueType === 'other' ? ' selected' : '') + '" onclick="showCustomIssueInput()">' +
        '<span class="issue-icon">?</span>' +
        'Other' +
    '</button>';

    grid.innerHTML = html;
}

/**
 * Handle selection of an issue type for guided capture.
 * @param {string} issueType
 */
function selectGuidedIssue(issueType) {
    guidedIssueType = issueType;
    guidedUploaded = {};
    currentGuide = null;
    renderIssueTypeGrid();
    loadEvidenceGuide(issueType);
}

/**
 * Show a text input for custom issue types (the "Other" option).
 */
function showCustomIssueInput() {
    guidedIssueType = 'other';
    guidedUploaded = {};
    currentGuide = null;
    renderIssueTypeGrid();

    var content = document.getElementById('ev-guide-content');
    content.innerHTML =
        '<div style="margin-bottom:12px">' +
            '<label style="font-weight:600;font-size:13px">Describe your issue</label>' +
            '<div class="row" style="margin-top:6px">' +
                '<div class="fg"><input class="inp" id="ev-custom-issue" placeholder="e.g. noise complaints, utility disputes..."></div>' +
                '<div><button class="btn btn-p" onclick="loadCustomIssueGuide()">Get Guidance</button></div>' +
            '</div>' +
        '</div>';
}

/**
 * Load evidence guide for a custom issue type entered by the user.
 */
function loadCustomIssueGuide() {
    var input = document.getElementById('ev-custom-issue');
    var issueText = input ? input.value.trim() : '';
    if (!issueText) return;
    loadEvidenceGuide(issueText);
}

/**
 * Fetch evidence collection guidance from the API for a given issue type.
 * @param {string} issueType
 */
async function loadEvidenceGuide(issueType) {
    var content = document.getElementById('ev-guide-content');
    var msg = document.getElementById('ev-guide-msg');

    content.innerHTML = '<p class="empty" style="text-align:center;padding:16px">Loading guidance...</p>';
    msg.textContent = '';
    msg.className = 'msg-t';

    try {
        var response = await fetch('/api/evidence/guide', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ issue_type: issueType })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to load guidance.');
            msg.textContent = errMsg;
            msg.className = 'msg-t msg-err';
            content.innerHTML = '';
            return;
        }

        currentGuide = await response.json();
        renderEvidenceGuide();
    } catch (error) {
        msg.textContent = 'Connection error. Check server is running.';
        msg.className = 'msg-t msg-err';
        content.innerHTML = '';
    }
}

/**
 * Render the evidence guide checklist and tips.
 */
function renderEvidenceGuide() {
    if (!currentGuide) return;
    var content = document.getElementById('ev-guide-content');
    var guide = currentGuide;

    var html = '<h4 style="margin-bottom:8px">' + guide.title + '</h4>';

    /* Checklist */
    if (guide.guidance && guide.guidance.length) {
        html += '<ul class="guide-checklist">';
        guide.guidance.forEach(function(item, index) {
            var isUploaded = guidedUploaded[index];
            var liClass = isUploaded ? ' uploaded' : '';
            var priority = item.priority || 'recommended';

            html += '<li class="' + liClass + '">' +
                '<span class="guide-priority ' + priority + '">' + priority + '</span>' +
                '<span class="guide-item-text">' + item.item + '</span>';

            if (isUploaded) {
                html += '<button class="guide-upload-btn done" disabled>Uploaded</button>';
            } else {
                html += '<button class="guide-upload-btn" onclick="triggerGuidedUpload(' + index + ')">Upload</button>';
            }

            html += '</li>';
        });
        html += '</ul>';
    }

    /* Hidden file input for guided uploads */
    html += '<input type="file" id="ev-guided-file" accept="image/*,.pdf" style="display:none">';

    /* Tips section */
    if (guide.tips && guide.tips.length) {
        html += '<div class="guide-tips">' +
            '<h5>Tips</h5><ul>';
        guide.tips.forEach(function(tip) {
            html += '<li>' + tip + '</li>';
        });
        html += '</ul></div>';
    }

    /* Source badge */
    if (guide.source === 'ai') {
        html += '<p style="font-size:11px;color:var(--text-muted);margin-top:8px;text-align:right">Guidance generated by AI</p>';
    }

    content.innerHTML = html;
}

/** Index of the checklist item currently being uploaded */
var guidedUploadIndex = -1;

/**
 * Trigger the file picker for a specific checklist item.
 * @param {number} index - The checklist item index
 */
function triggerGuidedUpload(index) {
    guidedUploadIndex = index;
    var fileInput = document.getElementById('ev-guided-file');
    if (!fileInput) return;

    /* Remove old listener and add fresh one */
    var newInput = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(newInput, fileInput);
    newInput.addEventListener('change', handleGuidedFileSelect);
    newInput.click();
}

/**
 * Handle file selection for guided upload. Uploads the file with
 * auto-generated title and category from the guide checklist.
 */
async function handleGuidedFileSelect() {
    var fileInput = document.getElementById('ev-guided-file');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) return;

    var msg = document.getElementById('ev-guide-msg');
    var guideItem = currentGuide.guidance[guidedUploadIndex];
    if (!guideItem) return;

    /* Map issue type to evidence category */
    var categoryMap = {
        mould_damp: 'photo_condition',
        lock_change: 'photo_condition',
        property_damage: 'photo_condition',
        harassment: 'correspondence',
        rent_dispute: 'receipt_payment'
    };
    var category = categoryMap[guidedIssueType] || 'other';

    var formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('title', guideItem.item.substring(0, 100));
    formData.append('category', category);
    formData.append('description', 'Guided capture: ' + (currentGuide.title || guidedIssueType));

    msg.textContent = 'Uploading...';
    msg.className = 'msg-t';

    try {
        var response = await fetch('/api/evidence', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken },
            body: formData
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Upload failed.');
            msg.textContent = errMsg;
            msg.className = 'msg-t msg-err';
            return;
        }

        /* Mark item as uploaded and re-render */
        guidedUploaded[guidedUploadIndex] = true;
        msg.textContent = 'Evidence uploaded for: ' + guideItem.item.substring(0, 50);
        msg.className = 'msg-t msg-ok';
        renderEvidenceGuide();

        /* Refresh evidence list below */
        var items = [];
        try {
            var listResponse = await fetch('/api/evidence', { headers: getAuthHeaders() });
            if (listResponse.ok) items = await listResponse.json();
        } catch (e) { /* ignore */ }
        renderEvidenceList(items);
    } catch (error) {
        msg.textContent = 'Upload error.';
        msg.className = 'msg-t msg-err';
    }
}

/**
 * Re-render just the evidence list portion (used after guided upload
 * to avoid resetting the guided capture wizard state).
 * @param {Array} items - Evidence items from API
 */
function renderEvidenceList(items) {
    /* Find existing evidence list and replace, or append after forms */
    var container = document.getElementById('evidence-container');
    var existingGrid = container.querySelector('.evidence-grid');
    var existingEmpty = container.querySelector('.empty:last-child');

    /* Build evidence list HTML */
    var html = '';
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
        html += '<p class="empty" style="text-align:center;padding:20px">No evidence uploaded yet.</p>';
    }

    /* Remove old list elements and append new */
    var oldSec = container.querySelector('.sec');
    if (oldSec) oldSec.remove();
    if (existingGrid) existingGrid.remove();
    if (existingEmpty) existingEmpty.remove();

    container.insertAdjacentHTML('beforeend', html);
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
                additional_context: context,
                language: currentLang
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
            body: JSON.stringify({ agreement_text: text, language: currentLang })
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
                notes: notes,
                language: currentLang
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
   16b. GDPR Data Rights
   -------------------------------------------------------------------------- */

/** Export all personal data (GDPR Subject Access Request). */
async function gdprExportData() {
    var btn = document.getElementById('gdpr-export-btn');
    var msg = document.getElementById('gdpr-msg');
    btn.disabled = true;
    msg.textContent = 'Preparing export...';
    msg.className = 'msg-t';
    try {
        var res = await fetch('/api/gdpr/export', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('Export failed');
        var data = await res.json();
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rentshield_data_export.json';
        a.click();
        URL.revokeObjectURL(url);
        msg.textContent = 'Data exported successfully.';
        msg.className = 'msg-t msg-ok';
    } catch (e) {
        msg.textContent = 'Failed to export data. Please try again.';
        msg.className = 'msg-t msg-err';
    } finally {
        btn.disabled = false;
    }
}

/** View the privacy policy in a new tab. */
function gdprViewPrivacy() {
    window.open('/api/gdpr/privacy-policy', '_blank');
}

/** Delete account and all associated data (GDPR Right to Erasure). */
async function gdprDeleteAccount() {
    var msg = document.getElementById('gdpr-msg');
    msg.textContent = '';

    var pw = prompt('This will permanently delete your account and all data.\n\nEnter your password to confirm:');
    if (!pw) return;

    if (!confirm('Are you absolutely sure? This action cannot be undone.')) return;

    var btn = document.getElementById('gdpr-delete-btn');
    btn.disabled = true;
    msg.textContent = 'Deleting account...';
    msg.className = 'msg-t';

    try {
        var res = await fetch('/api/gdpr/account', {
            method: 'DELETE',
            headers: getAuthHeaders(),
            body: JSON.stringify({ password: pw }),
        });
        var data = await res.json();
        if (!res.ok) {
            msg.textContent = data.detail || 'Deletion failed.';
            msg.className = 'msg-t msg-err';
            btn.disabled = false;
            return;
        }
        msg.textContent = 'Account deleted. Logging out...';
        msg.className = 'msg-t msg-ok';
        setTimeout(logout, 1500);
    } catch (e) {
        msg.textContent = 'Connection error. Please try again.';
        msg.className = 'msg-t msg-err';
        btn.disabled = false;
    }
}


/* --------------------------------------------------------------------------
   17. PDF Export
   -------------------------------------------------------------------------- */

/**
 * Add a consistent branded header to a jsPDF document.
 * Returns the Y position after the header for content to start.
 * @param {Object} doc - jsPDF document instance
 * @param {string} title - Document title
 * @returns {number} Y position below the header
 */
function pdfHeader(doc, title) {
    /* Brand line */
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(27, 42, 74);
    doc.text('RentShield', 14, 18);

    /* Subtitle */
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(74, 85, 104);
    doc.text(title, 14, 26);

    /* Date and disclaimer */
    doc.setFontSize(8);
    doc.setTextColor(140, 149, 166);
    doc.text('Exported: ' + new Date().toLocaleString('en-GB'), 14, 33);
    doc.text('General legal information — not professional legal advice.', 14, 37);

    /* Divider line */
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 40, 196, 40);

    doc.setTextColor(0, 0, 0);
    return 48;
}

/**
 * Add page number footer to all pages of a jsPDF document.
 * Call this after all content is added, before saving.
 * @param {Object} doc - jsPDF document instance
 */
function pdfPageNumbers(doc) {
    var totalPages = doc.internal.getNumberOfPages();
    for (var i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(140, 149, 166);
        doc.text('Page ' + i + ' of ' + totalPages, 14, 290);
        doc.text('RentShield - UK Renters\' Rights Navigator', 196, 290, { align: 'right' });
    }
}

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

/**
 * Export maintenance requests as a PDF document.
 */
async function exportMaintenancePdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    try {
        var response = await fetch('/api/maintenance', { headers: getAuthHeaders() });
        if (!response.ok) { alert('Failed to load maintenance data.'); return; }
        var data = await response.json();
        var requests = data.requests || data;
        if (!Array.isArray(requests) || requests.length === 0) {
            alert('No maintenance requests to export.');
            return;
        }

        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF();
        var y = pdfHeader(doc, 'Maintenance Requests');

        requests.forEach(function(req, index) {
            var blockHeight = 35;
            if (y + blockHeight > 275) { doc.addPage(); y = 20; }

            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text((index + 1) + '. ' + (req.title || req.category || 'Request'), 14, y);
            y += 6;

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text('Status: ' + (req.status || 'pending') + '  |  Category: ' + (req.category || 'N/A'), 14, y);
            y += 5;

            if (req.description) {
                var lines = doc.splitTextToSize(req.description, 170);
                doc.text(lines, 14, y);
                y += lines.length * 4 + 2;
            }

            if (req.created_at) {
                doc.setTextColor(140, 149, 166);
                doc.text('Submitted: ' + new Date(req.created_at).toLocaleString('en-GB'), 14, y);
                doc.setTextColor(0, 0, 0);
                y += 5;
            }

            doc.setDrawColor(220, 220, 220);
            doc.line(14, y, 196, y);
            y += 6;
        });

        pdfPageNumbers(doc);
        doc.save('rentshield-maintenance-' + formatDateForFilename() + '.pdf');
    } catch (error) {
        alert('Failed to export maintenance PDF.');
    }
}

/**
 * Export landlord compliance dashboard as a PDF document.
 */
async function exportCompliancePdf() {
    if (typeof window.jspdf === 'undefined') {
        alert('PDF library is still loading. Please try again in a moment.');
        return;
    }

    try {
        var response = await fetch('/api/compliance', { headers: getAuthHeaders() });
        if (!response.ok) { alert('Failed to load compliance data.'); return; }
        var data = await response.json();

        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF();
        var y = pdfHeader(doc, 'Compliance Dashboard — Score: ' + data.score + '%');

        doc.setFontSize(10);
        doc.text(data.compliant_count + ' of ' + data.total_count + ' requirements met', 14, y);
        y += 10;

        data.items.forEach(function(item, index) {
            var blockHeight = 30;
            if (y + blockHeight > 275) { doc.addPage(); y = 20; }

            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.text((index + 1) + '. ' + item.title, 14, y);

            /* Status badge text */
            var statusLabel = (COMPLIANCE_STATUS[item.status] || {}).label || item.status;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text('[' + statusLabel + ']', 180, y);
            y += 6;

            doc.setFontSize(9);
            var descLines = doc.splitTextToSize(item.description, 170);
            doc.text(descLines, 14, y);
            y += descLines.length * 4 + 2;

            doc.setTextColor(140, 149, 166);
            doc.text('Ref: ' + item.legal_reference, 14, y);
            y += 4;
            doc.text('Penalty: ' + item.penalty, 14, y);
            doc.setTextColor(0, 0, 0);
            y += 6;

            if (item.completed_date) { doc.text('Completed: ' + item.completed_date, 14, y); y += 4; }
            if (item.expiry_date) { doc.text('Expires: ' + item.expiry_date, 14, y); y += 4; }

            doc.setDrawColor(220, 220, 220);
            doc.line(14, y, 196, y);
            y += 6;
        });

        pdfPageNumbers(doc);
        doc.save('rentshield-compliance-' + formatDateForFilename() + '.pdf');
    } catch (error) {
        alert('Failed to export compliance PDF.');
    }
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
   19. Landlord Compliance Dashboard
   -------------------------------------------------------------------------- */

/** Status colours for compliance cards */
var COMPLIANCE_STATUS = {
    compliant:   { label: 'Compliant',   cls: 'b-approved' },
    due_soon:    { label: 'Due Soon',    cls: 'b-submitted' },
    overdue:     { label: 'Overdue',     cls: 'b-rejected' },
    not_started: { label: 'Not Started', cls: 'b-pending' }
};

/**
 * Load the landlord compliance dashboard.
 */
async function loadCompliance() {
    var container = document.getElementById('compliance-container');
    if (!container) return;
    container.innerHTML = '<p class="empty">Loading compliance data...</p>';

    try {
        var response = await fetch('/api/compliance', { headers: getAuthHeaders() });
        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to load compliance.');
            container.innerHTML = '<p class="msg-t msg-err">' + errMsg + '</p>';
            return;
        }

        var data = await response.json();
        renderCompliance(container, data);
    } catch (error) {
        container.innerHTML = '<p class="msg-t msg-err">Connection error.</p>';
    }
}

/**
 * Render the compliance dashboard cards.
 * @param {HTMLElement} container - The container element
 * @param {Object} data - Compliance data from API
 */
function renderCompliance(container, data) {
    var scoreClass = data.score >= 80 ? 'msg-ok' : (data.score >= 50 ? '' : 'msg-err');
    var html = '' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
            '<h2 class="ph">Compliance Dashboard</h2>' +
            '<button class="export-btn" onclick="exportCompliancePdf()" aria-label="Export compliance as PDF">Export PDF</button>' +
        '</div>' +
        '<p class="pp">Track your legal obligations as a UK landlord. Keep all certifications current to avoid penalties.</p>' +
        '<div class="card" style="text-align:center;margin-bottom:20px">' +
            '<div style="font-size:36px;font-weight:700" class="' + scoreClass + '">' + data.score + '%</div>' +
            '<div style="font-size:12px;color:var(--text-secondary)">' + data.compliant_count + ' of ' + data.total_count + ' requirements met</div>' +
        '</div>' +
        '<div class="grid">';

    data.items.forEach(function(item) {
        var st = COMPLIANCE_STATUS[item.status] || COMPLIANCE_STATUS.not_started;
        var expiry = item.expiry_date ? '<div class="meta">Expires: ' + item.expiry_date + '</div>' : '';
        var completed = item.completed_date ? '<div class="meta">Completed: ' + item.completed_date + '</div>' : '';

        html += '' +
            '<div class="card">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
                    '<h4>' + item.title + '</h4>' +
                    '<span class="badge ' + st.cls + '">' + st.label + '</span>' +
                '</div>' +
                '<p>' + item.description + '</p>' +
                '<div class="meta" style="margin-top:6px">Ref: ' + item.legal_reference + '</div>' +
                '<div class="meta" style="color:var(--danger)">Penalty: ' + item.penalty + '</div>' +
                completed + expiry +
                (item.notes ? '<div class="meta">Notes: ' + item.notes + '</div>' : '') +
                '<div class="acts">' +
                    '<button class="btn btn-sm btn-g" onclick="showComplianceForm(\'' + item.requirement_id + '\', \'compliant\')">Mark Compliant</button>' +
                    '<button class="btn btn-sm btn-o" onclick="showComplianceForm(\'' + item.requirement_id + '\', \'due_soon\')">Due Soon</button>' +
                    '<button class="btn btn-sm btn-d" onclick="showComplianceForm(\'' + item.requirement_id + '\', \'overdue\')">Overdue</button>' +
                '</div>' +
                '<div id="cf-' + item.requirement_id + '" class="hidden" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
                    '<div class="row">' +
                        '<div class="fg"><label>Completed Date</label><input class="inp" type="date" id="cd-' + item.requirement_id + '"></div>' +
                        '<div class="fg"><label>Expiry Date</label><input class="inp" type="date" id="ed-' + item.requirement_id + '"></div>' +
                    '</div>' +
                    '<div class="fg" style="margin-top:6px"><label>Notes</label><input class="inp" type="text" id="cn-' + item.requirement_id + '" placeholder="Optional notes" value="' + (item.notes || '').replace(/"/g, '&quot;') + '"></div>' +
                    '<div class="acts">' +
                        '<button class="btn btn-sm btn-p" onclick="saveComplianceItem(\'' + item.requirement_id + '\')">Save</button>' +
                        '<button class="btn btn-sm btn-o" onclick="document.getElementById(\'cf-' + item.requirement_id + '\').classList.add(\'hidden\')">Cancel</button>' +
                    '</div>' +
                    '<div class="msg-t" id="cm-' + item.requirement_id + '"></div>' +
                '</div>' +
            '</div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

/** Pending compliance status for the form */
var pendingComplianceStatus = '';

/**
 * Show the compliance update form for a requirement.
 * @param {string} reqId - Requirement ID
 * @param {string} status - The status to set
 */
function showComplianceForm(reqId, status) {
    pendingComplianceStatus = status;
    var form = document.getElementById('cf-' + reqId);
    if (form) form.classList.remove('hidden');
}

/**
 * Save updated compliance status for a requirement.
 * @param {string} reqId - Requirement ID
 */
async function saveComplianceItem(reqId) {
    var completedDate = document.getElementById('cd-' + reqId).value;
    var expiryDate = document.getElementById('ed-' + reqId).value;
    var notes = document.getElementById('cn-' + reqId).value.trim();
    var msgEl = document.getElementById('cm-' + reqId);

    try {
        var response = await fetch('/api/compliance/' + reqId, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                status: pendingComplianceStatus,
                completed_date: completedDate || null,
                expiry_date: expiryDate || null,
                notes: notes || null
            })
        });

        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to update.');
            msgEl.textContent = errMsg;
            msgEl.className = 'msg-t msg-err';
            return;
        }

        msgEl.textContent = 'Updated.';
        msgEl.className = 'msg-t msg-ok';
        setTimeout(function() { loadCompliance(); }, 500);
    } catch (error) {
        msgEl.textContent = 'Connection error.';
        msgEl.className = 'msg-t msg-err';
    }
}


/* --------------------------------------------------------------------------
   20. Community Knowledge Base
   -------------------------------------------------------------------------- */

/** Category display names for knowledge base */
var KB_CATEGORIES = {
    eviction: 'Eviction & Notices',
    rent_increases: 'Rent Increases',
    repairs: 'Repairs & Maintenance',
    deposits: 'Deposit Disputes',
    tenant_rights: 'Tenant Rights',
    landlord_obligations: 'Landlord Obligations',
    emergency: 'Emergency'
};

/**
 * Load the community knowledge base page.
 * @param {string} [query] - Optional search query
 * @param {string} [category] - Optional category filter
 */
async function loadKnowledgeBase(query, category) {
    var container = document.getElementById('knowledge-container');
    if (!container) return;

    /* Build search UI on first load */
    var searchHtml = '' +
        '<h2 class="ph">Knowledge Base</h2>' +
        '<p class="pp">Common questions about UK renters\' rights. Find instant answers before asking the AI.</p>' +
        '<div class="row" style="margin-bottom:16px">' +
            '<div class="fg" style="flex:3"><input class="inp" id="kb-search" type="text" placeholder="Search questions..." value="' + (query || '') + '" onkeydown="if(event.key===\'Enter\')searchKnowledgeBase()"></div>' +
            '<div class="fg" style="flex:1"><select class="inp" id="kb-cat" onchange="searchKnowledgeBase()"><option value="">All Categories</option></select></div>' +
            '<button class="btn btn-p" onclick="searchKnowledgeBase()">Search</button>' +
        '</div>' +
        '<div id="kb-results"><p class="empty">Loading...</p></div>';

    container.innerHTML = searchHtml;

    /* Fetch articles */
    var url = '/api/knowledge';
    var params = [];
    if (query) params.push('q=' + encodeURIComponent(query));
    if (category) params.push('category=' + encodeURIComponent(category));
    if (params.length > 0) url += '?' + params.join('&');

    try {
        var response = await fetch(url);
        if (!response.ok) {
            document.getElementById('kb-results').innerHTML = '<p class="msg-t msg-err">Failed to load articles.</p>';
            return;
        }

        var data = await response.json();

        /* Populate category dropdown */
        var catSelect = document.getElementById('kb-cat');
        if (catSelect && data.categories) {
            var catHtml = '<option value="">All Categories</option>';
            data.categories.forEach(function(cat) {
                var label = KB_CATEGORIES[cat] || cat.replace(/_/g, ' ');
                var selected = (category === cat) ? ' selected' : '';
                catHtml += '<option value="' + cat + '"' + selected + '>' + label + '</option>';
            });
            catSelect.innerHTML = catHtml;
        }

        renderKnowledgeArticles(data.articles);
    } catch (error) {
        document.getElementById('kb-results').innerHTML = '<p class="msg-t msg-err">Connection error.</p>';
    }
}

/**
 * Trigger a knowledge base search from the UI inputs.
 */
function searchKnowledgeBase() {
    var query = document.getElementById('kb-search').value.trim();
    var category = document.getElementById('kb-cat').value;
    loadKnowledgeBase(query || null, category || null);
}

/**
 * Render knowledge base articles as accordion cards.
 * @param {Array} articles - Array of article objects
 */
function renderKnowledgeArticles(articles) {
    var resultsEl = document.getElementById('kb-results');
    if (!resultsEl) return;

    if (!articles || articles.length === 0) {
        resultsEl.innerHTML = '<p class="empty">No articles found. Try a different search term.</p>';
        return;
    }

    var html = '';
    articles.forEach(function(article) {
        var catLabel = KB_CATEGORIES[article.category] || article.category;
        var helpful = article.helpful_count || 0;

        html += '' +
            '<div class="card" style="cursor:pointer" onclick="toggleKbArticle(\'' + article.article_id + '\')">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
                    '<h4 style="flex:1">' + article.question + '</h4>' +
                    '<span class="badge b-pending" style="margin-left:8px;flex-shrink:0">' + catLabel + '</span>' +
                '</div>' +
                '<div id="kb-body-' + article.article_id + '" class="hidden" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">' +
                    '<p style="font-size:13px;line-height:1.7;white-space:pre-line">' + article.answer + '</p>' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">' +
                        '<div style="font-size:11px;color:var(--text-muted)">' + helpful + ' people found this helpful</div>' +
                        '<button class="btn btn-sm btn-o" onclick="event.stopPropagation();markHelpful(\'' + article.article_id + '\', this)">Helpful</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
    });

    resultsEl.innerHTML = html;
}

/**
 * Toggle visibility of a knowledge base article body.
 * @param {string} articleId - Article identifier
 */
function toggleKbArticle(articleId) {
    var body = document.getElementById('kb-body-' + articleId);
    if (body) body.classList.toggle('hidden');
}

/**
 * Mark a knowledge base article as helpful.
 * @param {string} articleId - Article identifier
 * @param {HTMLElement} btn - The button clicked
 */
async function markHelpful(articleId, btn) {
    try {
        var response = await fetch('/api/knowledge/' + articleId + '/helpful', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        if (response.ok) {
            btn.textContent = 'Thanks!';
            btn.disabled = true;
        }
    } catch (error) {
        /* Silently fail — non-critical */
    }
}


/* --------------------------------------------------------------------------
   21. Admin Analytics Dashboard
   -------------------------------------------------------------------------- */

/** Urgency chart colours */
var URGENCY_COLORS = {
    critical: '#C0392B',
    high: '#D4903A',
    medium: '#2B8A7E',
    low: '#27864A'
};

/**
 * Load the admin analytics dashboard.
 */
async function loadAdminAnalytics() {
    var container = document.getElementById('admin-analytics-container');
    if (!container) return;
    container.innerHTML = '<p class="empty">Loading analytics...</p>';

    try {
        var response = await fetch('/api/admin/analytics', { headers: getAuthHeaders() });
        if (!response.ok) {
            var errMsg = await getResponseError(response, 'Failed to load analytics.');
            container.innerHTML = '<p class="msg-t msg-err">' + errMsg + '</p>';
            return;
        }

        var data = await response.json();
        renderAdminAnalytics(container, data);
    } catch (error) {
        container.innerHTML = '<p class="msg-t msg-err">Connection error.</p>';
    }
}

/**
 * Render the admin analytics dashboard with stat cards and charts.
 * @param {HTMLElement} container - Container element
 * @param {Object} data - Analytics data from API
 */
function renderAdminAnalytics(container, data) {
    var html = '' +
        '<h2 class="ph">Analytics Dashboard</h2>' +
        '<p class="pp">Overview of platform usage, issues, and engagement.</p>' +

        /* Stat cards row */
        '<div class="grid">' +
            buildStatCard('Total Users', data.users.total, 'Landlords: ' + data.users.landlords + ' / Tenants: ' + data.users.tenants) +
            buildStatCard('Conversations', data.conversations, 'Total AI chat sessions') +
            buildStatCard('Maintenance', data.maintenance.open + ' open', 'Resolved: ' + data.maintenance.resolved + ' / Total: ' + data.maintenance.total) +
            buildStatCard('Wellbeing', 'Avg ' + data.wellbeing.average_mood + '/5', data.wellbeing.journal_entries + ' journal entries') +
        '</div>' +

        /* Charts row */
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">' +
            '<div class="card"><h4>Issues by Type</h4><canvas id="chart-issues" height="200"></canvas></div>' +
            '<div class="card"><h4>Urgency Breakdown</h4><canvas id="chart-urgency" height="200"></canvas></div>' +
        '</div>' +

        /* Recent activity */
        '<div style="margin-top:16px">' +
            '<div class="sec">Recent Activity</div>';

    if (data.recent_activity && data.recent_activity.length > 0) {
        data.recent_activity.forEach(function(event) {
            var issue = (event.issue_type || 'unknown').replace(/_/g, ' ');
            var urgency = event.urgency || 'low';
            var userType = event.user_type || 'unknown';
            var time = event.timestamp ? new Date(event.timestamp).toLocaleString() : '';
            html += '<div class="card" style="padding:10px 14px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                    '<span style="font-size:12px"><strong>' + issue + '</strong> — ' + userType + '</span>' +
                    '<span class="badge ' + (urgency === 'critical' ? 'b-rejected' : urgency === 'high' ? 'b-submitted' : 'b-pending') + '">' + urgency + '</span>' +
                '</div>' +
                '<div class="meta">' + time + '</div>' +
            '</div>';
        });
    } else {
        html += '<p class="empty">No recent activity.</p>';
    }

    html += '</div>';
    container.innerHTML = html;

    /* Render charts after DOM is updated */
    setTimeout(function() {
        renderIssuesChart(data.issues);
        renderUrgencyChart(data.urgency);
    }, 50);
}

/**
 * Build a stat card HTML string.
 * @param {string} title - Card title
 * @param {string|number} value - Main value
 * @param {string} subtitle - Subtitle text
 * @returns {string} HTML string
 */
function buildStatCard(title, value, subtitle) {
    return '<div class="card" style="text-align:center">' +
        '<div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">' + title + '</div>' +
        '<div style="font-size:28px;font-weight:700;color:var(--text);margin:4px 0">' + value + '</div>' +
        '<div style="font-size:11px;color:var(--text-secondary)">' + subtitle + '</div>' +
    '</div>';
}

/**
 * Render the issues bar chart using Chart.js.
 * @param {Array} issues - Array of { type, count }
 */
function renderIssuesChart(issues) {
    var canvas = document.getElementById('chart-issues');
    if (!canvas || typeof Chart === 'undefined') return;

    var labels = issues.map(function(i) { return i.type.replace(/_/g, ' '); });
    var counts = issues.map(function(i) { return i.count; });

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: counts,
                backgroundColor: '#2B8A7E',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { ticks: { maxRotation: 45 } }
            }
        }
    });
}

/**
 * Render the urgency donut chart using Chart.js.
 * @param {Array} urgency - Array of { level, count }
 */
function renderUrgencyChart(urgency) {
    var canvas = document.getElementById('chart-urgency');
    if (!canvas || typeof Chart === 'undefined') return;

    var labels = urgency.map(function(u) { return u.level; });
    var counts = urgency.map(function(u) { return u.count; });
    var colors = urgency.map(function(u) { return URGENCY_COLORS[u.level] || '#8C95A6'; });

    new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--white').trim()
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } }
            }
        }
    });
}


/* --------------------------------------------------------------------------
   21. Dashboard Home Screen
   -------------------------------------------------------------------------- */

async function loadDashboard() {
    var container = document.getElementById('dashboard-container');
    if (!container) return;
    container.innerHTML = '<p class="empty">Loading dashboard...</p>';

    try {
        var resp = await fetch('/api/dashboard', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed to load dashboard');
        var data = await resp.json();

        var html = '<h2 class="ph">Dashboard</h2>';
        html += '<p class="pp">Welcome back, ' + (data.name || currentUser.name || '') + '</p>';

        if (data.role === 'tenant') {
            html += '<div class="dashboard-grid">';
            html += '<div class="dash-card"><div class="dash-num">' + (data.overdue_maintenance_count || 0) + '</div><div class="dash-label">Overdue Repairs</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.pending_tasks || 0) + '</div><div class="dash-label">Pending Tasks</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.total_points || 0) + '</div><div class="dash-label">Points</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.wellbeing_streak || 0) + '</div><div class="dash-label">Day Streak</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.evidence_count || 0) + '</div><div class="dash-label">Evidence Items</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.conversation_count || 0) + '</div><div class="dash-label">Conversations</div></div>';
            html += '</div>';

            if (data.active_maintenance && data.active_maintenance.length > 0) {
                html += '<div class="sec" style="margin-top:20px">Active Maintenance Requests</div>';
                data.active_maintenance.forEach(function(req) {
                    var badge = req.is_overdue ? '<span class="overdue-badge">OVERDUE</span>' : '<span class="ontime-badge">On Track</span>';
                    html += '<div class="card" style="margin-bottom:8px"><strong>' + escapeHtml(req.category_name || '') + '</strong> ' + badge + '<br><span style="font-size:13px;color:var(--text-secondary)">' + escapeHtml((req.description || '').substring(0, 80)) + '</span></div>';
                });
            }
        } else if (data.role === 'landlord') {
            html += '<div class="dashboard-grid">';
            html += '<div class="dash-card"><div class="dash-num">' + (data.tenant_count || 0) + '</div><div class="dash-label">Tenants</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.open_maintenance || 0) + '</div><div class="dash-label">Open Requests</div></div>';
            html += '<div class="dash-card' + (data.overdue_maintenance > 0 ? ' dash-alert' : '') + '"><div class="dash-num">' + (data.overdue_maintenance || 0) + '</div><div class="dash-label">Overdue</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.pending_verifications || 0) + '</div><div class="dash-label">Pending Approvals</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.compliance_score || 0) + '%</div><div class="dash-label">Compliance</div></div>';
            html += '<div class="dash-card"><div class="dash-num">' + (data.pending_perk_claims || 0) + '</div><div class="dash-label">Perk Claims</div></div>';
            html += '</div>';
        }

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p class="empty">Could not load dashboard.</p>';
    }
}

/* --------------------------------------------------------------------------
   22. Notifications
   -------------------------------------------------------------------------- */

async function loadNotifications() {
    try {
        var resp = await fetch('/api/notifications', { headers: getAuthHeaders() });
        if (!resp.ok) return;
        var data = await resp.json();

        var badge = document.getElementById('notif-badge');
        if (badge) {
            if (data.unread_count > 0) {
                badge.textContent = data.unread_count > 9 ? '9+' : data.unread_count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }

        var dropdown = document.getElementById('notif-dropdown');
        if (dropdown && dropdown.classList.contains('open')) {
            renderNotifications(data.notifications);
        }
    } catch (e) { /* silent */ }
}

function renderNotifications(notifications) {
    var dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;

    if (!notifications || notifications.length === 0) {
        dropdown.innerHTML = '<div class="notif-empty">No notifications</div>';
        return;
    }

    dropdown.innerHTML = '';
    notifications.slice(0, 10).forEach(function(n) {
        var item = document.createElement('div');
        item.className = n.is_read ? 'notif-item read' : 'notif-item unread';
        var title = document.createElement('div');
        title.className = 'notif-title';
        title.textContent = n.title;
        var msg = document.createElement('div');
        msg.className = 'notif-msg';
        msg.textContent = n.message;
        item.appendChild(title);
        item.appendChild(msg);
        item.addEventListener('click', function() {
            handleNotifClick(n.notification_id, n.link_to || '');
        });
        dropdown.appendChild(item);
    });
    var footer = document.createElement('div');
    footer.className = 'notif-footer';
    footer.textContent = 'Mark all as read';
    footer.addEventListener('click', markAllNotificationsRead);
    dropdown.appendChild(footer);
}

function toggleNotifications() {
    var dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) loadNotifications();
}

async function handleNotifClick(notifId, linkTo) {
    try {
        await fetch('/api/notifications/' + notifId + '/read', { method: 'POST', headers: getAuthHeaders() });
    } catch (e) { /* silent */ }
    if (linkTo) navigateTo(linkTo);
    loadNotifications();
}

async function markAllNotificationsRead() {
    try {
        await fetch('/api/notifications/read-all', { method: 'POST', headers: getAuthHeaders() });
    } catch (e) { /* silent */ }
    loadNotifications();
}

/* --------------------------------------------------------------------------
   23. Notice Validity Calculator
   -------------------------------------------------------------------------- */

function loadNoticeCalculator() {
    var container = document.getElementById('notice-calc-container');
    if (!container) return;

    container.innerHTML =
        '<h2 class="ph">Notice Validity Calculator</h2>' +
        '<p class="pp">Check if a landlord notice meets legal requirements using deterministic rules (no AI guesswork).</p>' +
        '<div class="card">' +
            '<label class="form-label">Notice Type</label>' +
            '<select id="nc-type" class="form-select">' +
                '<option value="landlord_notice_to_end">Landlord Notice to End Tenancy</option>' +
                '<option value="section_8">Section 8 (Fault-Based)</option>' +
                '<option value="rent_increase">Section 13 (Rent Increase)</option>' +
                '<option value="tenant_notice">Tenant Notice to Leave</option>' +
            '</select>' +
            '<label class="form-label">Date You Received the Notice</label>' +
            '<input type="date" id="nc-received" class="form-input">' +
            '<label class="form-label">Date You Must Leave / Pay By</label>' +
            '<input type="date" id="nc-effective" class="form-input">' +
            '<label class="form-label">Tenancy Start Date (optional)</label>' +
            '<input type="date" id="nc-tenancy-start" class="form-input">' +
            '<label class="form-label" style="margin-top:10px">' +
                '<input type="checkbox" id="nc-prescribed"> Landlord has provided all prescribed information (Gas Safety, EPC, How to Rent guide)' +
            '</label>' +
            '<button class="btn btn-p" onclick="runNoticeCalculator()" style="margin-top:14px">Check Validity</button>' +
        '</div>' +
        '<div id="nc-result"></div>';
}

async function runNoticeCalculator() {
    var resultDiv = document.getElementById('nc-result');
    resultDiv.innerHTML = '<p class="empty">Checking...</p>';

    var body = {
        notice_type: document.getElementById('nc-type').value,
        date_received: document.getElementById('nc-received').value,
        effective_date: document.getElementById('nc-effective').value,
        tenancy_start_date: document.getElementById('nc-tenancy-start').value || '',
        has_prescribed_info: document.getElementById('nc-prescribed').checked,
        ground: 'default'
    };

    if (!body.date_received || !body.effective_date) {
        resultDiv.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Please enter both dates.</div>';
        return;
    }

    try {
        var resp = await fetch('/api/notice-calculator/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            var err = await resp.json();
            resultDiv.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">' + (err.detail || 'Error') + '</div>';
            return;
        }
        var data = await resp.json();

        var color = data.is_valid ? 'var(--success)' : 'var(--danger)';
        var verdict = data.is_valid ? 'APPEARS VALID' : 'POTENTIAL ISSUES FOUND';

        var html = '<div class="card" style="border-left:4px solid ' + color + ';margin-top:14px">';
        html += '<h3 style="color:' + color + '">' + verdict + '</h3>';
        html += '<p><strong>Notice type:</strong> ' + data.notice_type_name + '</p>';
        html += '<p><strong>Notice given:</strong> ' + data.actual_notice_given_days + ' days</p>';
        html += '<p><strong>Minimum required:</strong> ' + data.minimum_notice_required_days + ' days</p>';

        if (data.problems.length > 0) {
            html += '<div class="sec" style="margin-top:12px;color:var(--danger)">Problems Found</div><ul>';
            data.problems.forEach(function(p) { html += '<li>' + p + '</li>'; });
            html += '</ul>';
        }

        html += '<div class="sec" style="margin-top:12px">What You Should Do</div><ul>';
        data.actions.forEach(function(a) { html += '<li>' + a + '</li>'; });
        html += '</ul>';

        html += '<div class="sec" style="margin-top:12px">Legal Requirements for This Notice Type</div><ul>';
        data.prescribed_requirements.forEach(function(r) { html += '<li>' + r + '</li>'; });
        html += '</ul>';

        html += '<p style="font-size:12px;color:var(--text-secondary);margin-top:10px">Source: ' + data.source + '</p>';
        html += '</div>';

        resultDiv.innerHTML = html;
    } catch (e) {
        resultDiv.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Could not check notice. Please try again.</div>';
    }
}

/* --------------------------------------------------------------------------
   24. Local Authority Lookup
   -------------------------------------------------------------------------- */

function loadLocalHelp() {
    var container = document.getElementById('local-help-container');
    if (!container) return;

    container.innerHTML =
        '<h2 class="ph">Find Local Help</h2>' +
        '<p class="pp">Enter your postcode to find your local council and housing support services.</p>' +
        '<div class="card">' +
            '<div style="display:flex;gap:8px">' +
                '<input type="text" id="la-postcode" class="form-input" placeholder="e.g. SW1A 1AA or M1" style="flex:1" maxlength="10">' +
                '<button class="btn btn-p" onclick="lookupLocalAuthority()">Search</button>' +
            '</div>' +
        '</div>' +
        '<div id="la-result"></div>' +
        '<div id="la-helplines"></div>';

    loadNationalHelplines();
}

async function lookupLocalAuthority() {
    var postcode = document.getElementById('la-postcode').value.trim();
    var resultDiv = document.getElementById('la-result');

    if (!postcode) {
        resultDiv.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Please enter a postcode.</div>';
        return;
    }

    resultDiv.innerHTML = '<p class="empty">Searching...</p>';

    try {
        var resp = await fetch('/api/local-authority/lookup?postcode=' + encodeURIComponent(postcode));
        if (!resp.ok) {
            var err = await resp.json();
            resultDiv.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">' + (err.detail || 'Error') + '</div>';
            return;
        }
        var data = await resp.json();

        var html = '<div class="card" style="margin-top:14px">';
        html += '<h3>Your Local Council</h3>';
        html += '<p><strong>' + data.local_council + '</strong></p>';

        if (data.local_services.length > 0) {
            data.local_services.forEach(function(s) {
                html += '<div style="margin-top:10px;padding:8px;background:var(--bg);border-radius:6px">';
                html += '<strong>' + s.name + '</strong><br>';
                html += '<span style="font-size:13px;color:var(--text-secondary)">' + s.description + '</span><br>';
                html += '<span style="font-size:12px;color:var(--primary)">' + s.action + '</span>';
                html += '</div>';
            });
        }

        if (data.note) {
            html += '<p style="font-size:12px;color:var(--text-secondary);margin-top:10px">' + data.note + '</p>';
        }
        html += '</div>';

        resultDiv.innerHTML = html;
    } catch (e) {
        resultDiv.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Could not look up postcode.</div>';
    }
}

async function loadNationalHelplines() {
    try {
        var resp = await fetch('/api/local-authority/helplines');
        if (!resp.ok) return;
        var data = await resp.json();
        var container = document.getElementById('la-helplines');
        if (!container) return;

        var html = '<div class="sec" style="margin-top:20px">National Helplines</div>';
        data.helplines.forEach(function(h) {
            html += '<div class="card" style="margin-bottom:8px">';
            html += '<strong>' + h.name + '</strong>';
            if (h.phone) html += ' — <a href="tel:' + h.phone.replace(/\s/g, '') + '">' + h.phone + '</a>';
            html += '<br><span style="font-size:13px;color:var(--text-secondary)">' + h.description + '</span>';
            if (h.hours) html += '<br><span style="font-size:12px">' + h.hours + '</span>';
            html += '</div>';
        });
        container.innerHTML = html;
    } catch (e) { /* silent */ }
}

/* --------------------------------------------------------------------------
   25. Case Export
   -------------------------------------------------------------------------- */

async function loadCaseExport() {
    var container = document.getElementById('case-export-container');
    if (!container) return;

    container.innerHTML =
        '<h2 class="ph">Export Case File</h2>' +
        '<p class="pp">Download a complete bundle of all your evidence, timeline, letters, chat history, and maintenance requests — ready for a solicitor or tribunal.</p>' +
        '<div class="card">' +
            '<button class="btn btn-p" onclick="downloadCaseBundle()" id="export-btn">Export My Case File (JSON)</button>' +
            '<p style="font-size:12px;color:var(--text-secondary);margin-top:8px">This may take a moment to compile all your data.</p>' +
        '</div>' +
        '<div id="export-summary"></div>';
}

async function downloadCaseBundle() {
    var btn = document.getElementById('export-btn');
    btn.disabled = true;
    btn.textContent = 'Compiling...';

    try {
        var resp = await fetch('/api/case-export', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Export failed');
        var data = await resp.json();

        /* Show summary */
        var summary = data.summary;
        var summaryHtml = '<div class="card" style="margin-top:14px"><h3>Export Summary</h3>';
        summaryHtml += '<p>Evidence items: ' + summary.total_evidence + '</p>';
        summaryHtml += '<p>Timeline events: ' + summary.total_timeline_events + '</p>';
        summaryHtml += '<p>Letters: ' + summary.total_letters + '</p>';
        summaryHtml += '<p>Maintenance requests: ' + summary.total_maintenance_requests + '</p>';
        summaryHtml += '<p>Conversations: ' + summary.total_conversations + '</p>';
        summaryHtml += '</div>';
        document.getElementById('export-summary').innerHTML = summaryHtml;

        /* Trigger download */
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rentshield-case-export-' + new Date().toISOString().split('T')[0] + '.json';
        a.click();
        URL.revokeObjectURL(url);

        btn.textContent = 'Export Complete — Download Again';
    } catch (e) {
        document.getElementById('export-summary').innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Export failed. Please try again.</div>';
        btn.textContent = 'Retry Export';
    }
    btn.disabled = false;
}

/* --------------------------------------------------------------------------
   26. Conversation Memory (persistent user context)
   -------------------------------------------------------------------------- */

/* Store key facts from conversations in localStorage for cross-session context */
function updateConversationMemory(detectedIssue, urgency) {
    var memory = JSON.parse(localStorage.getItem('rs_memory') || '{}');

    if (!memory.issues) memory.issues = {};
    if (!memory.issues[detectedIssue]) memory.issues[detectedIssue] = 0;
    memory.issues[detectedIssue]++;

    if (urgency === 'critical' || urgency === 'high') {
        memory.lastUrgentIssue = detectedIssue;
        memory.lastUrgentDate = new Date().toISOString();
    }

    memory.lastActivity = new Date().toISOString();
    memory.totalQueries = (memory.totalQueries || 0) + 1;

    localStorage.setItem('rs_memory', JSON.stringify(memory));
}

/* --------------------------------------------------------------------------
   27. Interactive Rights Quiz
   -------------------------------------------------------------------------- */

/** Current quiz state */
var quizQuestions = [];
var quizCurrentIndex = 0;
var quizAnswered = {};

async function loadQuiz() {
    var container = document.getElementById('quiz-container');
    container.innerHTML = '<h2 class="ph">Rights Quiz</h2><p class="pp">Test your knowledge of UK renting rights with real-world scenarios. Earn 10 points for each correct answer!</p><div id="quiz-progress-bar"></div><div id="quiz-area"><p class="empty">Loading questions...</p></div>';

    try {
        var resp = await fetch('/api/quiz/questions', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed to load quiz');
        quizQuestions = await resp.json();
        quizCurrentIndex = 0;
        quizAnswered = {};

        /* Also load progress */
        var progResp = await fetch('/api/quiz/progress', { headers: getAuthHeaders() });
        var progress = progResp.ok ? await progResp.json() : null;

        var progressHtml = '';
        if (progress && progress.total_answered > 0) {
            progressHtml = '<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-around;text-align:center">' +
                '<div><div style="font-size:24px;font-weight:700;color:var(--primary)">' + progress.total_correct + '/' + progress.total_answered + '</div><div style="font-size:12px;color:var(--text-secondary)">Correct</div></div>' +
                '<div><div style="font-size:24px;font-weight:700;color:var(--success)">' + progress.accuracy_pct + '%</div><div style="font-size:12px;color:var(--text-secondary)">Accuracy</div></div>' +
                '<div><div style="font-size:24px;font-weight:700;color:var(--warning)">' + progress.points_earned + '</div><div style="font-size:12px;color:var(--text-secondary)">Points Earned</div></div>' +
            '</div></div>';
        }
        document.getElementById('quiz-progress-bar').innerHTML = progressHtml;

        renderQuizQuestion();
    } catch (e) {
        container.innerHTML = '<h2 class="ph">Rights Quiz</h2><p class="empty">Failed to load quiz. Please try again.</p>';
    }
}

function renderQuizQuestion() {
    var area = document.getElementById('quiz-area');
    if (quizCurrentIndex >= quizQuestions.length) {
        area.innerHTML = '<div class="card" style="text-align:center;padding:30px">' +
            '<h3>Quiz Complete!</h3>' +
            '<p>You\'ve answered all ' + quizQuestions.length + ' questions.</p>' +
            '<button class="btn btn-p" onclick="quizCurrentIndex=0;quizAnswered={};renderQuizQuestion()">Retake Quiz</button>' +
        '</div>';
        return;
    }

    var q = quizQuestions[quizCurrentIndex];
    var html = '<div class="card">' +
        '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Question ' + (quizCurrentIndex + 1) + ' of ' + quizQuestions.length + ' — ' + escapeHtml(q.category.replace(/_/g, ' ')) + '</div>' +
        '<div style="background:var(--bg-secondary);padding:12px;border-radius:8px;margin-bottom:12px;font-style:italic">' + escapeHtml(q.scenario) + '</div>' +
        '<h4 style="margin-bottom:12px">' + escapeHtml(q.question) + '</h4>' +
        '<div id="quiz-options">';

    q.options.forEach(function(opt, i) {
        html += '<button class="btn btn-o quiz-opt" style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:10px 14px" data-idx="' + i + '" onclick="submitQuizAnswer(\'' + q.id + '\',' + i + ')">' +
            '<strong>' + String.fromCharCode(65 + i) + '.</strong> ' + escapeHtml(opt) +
        '</button>';
    });

    html += '</div><div id="quiz-feedback"></div>' +
        '<div style="display:flex;justify-content:space-between;margin-top:12px">' +
            '<span style="font-size:12px;color:var(--text-secondary)">' + Object.keys(quizAnswered).length + ' answered</span>' +
        '</div></div>';

    area.innerHTML = html;
}

async function submitQuizAnswer(questionId, selectedOption) {
    if (quizAnswered[questionId] !== undefined) return;
    quizAnswered[questionId] = selectedOption;

    /* Disable all options */
    document.querySelectorAll('.quiz-opt').forEach(function(btn) { btn.disabled = true; });

    try {
        var resp = await fetch('/api/quiz/answer', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ question_id: questionId, selected_option: selectedOption })
        });
        if (!resp.ok) throw new Error('Failed to submit answer');
        var data = await resp.json();

        /* Highlight correct/incorrect */
        document.querySelectorAll('.quiz-opt').forEach(function(btn) {
            var idx = parseInt(btn.getAttribute('data-idx'));
            if (idx === data.correct_option) {
                btn.style.borderColor = 'var(--success)';
                btn.style.background = 'rgba(39, 134, 74, 0.1)';
            } else if (idx === selectedOption && !data.correct) {
                btn.style.borderColor = 'var(--danger)';
                btn.style.background = 'rgba(192, 57, 43, 0.1)';
            }
        });

        /* Show feedback */
        var feedbackHtml = '<div class="card" style="margin-top:12px;border-left:3px solid ' + (data.correct ? 'var(--success)' : 'var(--danger)') + '">' +
            '<strong>' + (data.correct ? 'Correct! +' + data.points_earned + ' points' : 'Incorrect') + '</strong>' +
            '<p style="margin-top:8px">' + escapeHtml(data.explanation) + '</p>' +
            '<p style="font-size:12px;color:var(--text-secondary);margin-top:4px">Source: ' + escapeHtml(data.source) + '</p>' +
            '<button class="btn btn-p" style="margin-top:10px" onclick="quizCurrentIndex++;renderQuizQuestion()">Next Question</button>' +
        '</div>';
        document.getElementById('quiz-feedback').innerHTML = feedbackHtml;

    } catch (e) {
        document.getElementById('quiz-feedback').innerHTML = '<p class="empty">Failed to submit answer.</p>';
    }
}


/* --------------------------------------------------------------------------
   28. AI Scenario Simulator
   -------------------------------------------------------------------------- */

async function loadScenarios() {
    var container = document.getElementById('scenarios-container');
    container.innerHTML = '<h2 class="ph">Scenario Simulator</h2><p class="pp">Explore "What would happen if..." scenarios with step-by-step legal outcomes.</p><div id="scenario-templates"></div><div id="scenario-custom"></div><div id="scenario-result"></div>';

    try {
        var resp = await fetch('/api/scenarios/templates', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed to load');
        var templates = await resp.json();

        var html = '<div class="sec">Choose a Scenario</div><div class="grid">';
        templates.forEach(function(t) {
            html += '<div class="card" style="cursor:pointer" onclick="runScenario(\'' + t.id + '\')">' +
                '<h4>' + escapeHtml(t.title) + '</h4>' +
                '<p style="font-size:13px;color:var(--text-secondary)">' + escapeHtml(t.description) + '</p>' +
                '<span class="badge">' + escapeHtml(t.category) + '</span>' +
            '</div>';
        });
        html += '</div>';

        html += '<div class="sec" style="margin-top:18px">Or Describe Your Own</div>' +
            '<textarea class="n-ta" id="custom-scenario" placeholder="Describe a situation... e.g., What would happen if my landlord refuses to return my deposit?" style="min-height:80px"></textarea>' +
            '<button class="btn btn-p" onclick="runScenario(null)">Simulate Scenario</button>';

        document.getElementById('scenario-templates').innerHTML = html;
    } catch (e) {
        container.innerHTML = '<h2 class="ph">Scenario Simulator</h2><p class="empty">Failed to load scenarios.</p>';
    }
}

async function runScenario(scenarioId) {
    var resultEl = document.getElementById('scenario-result');
    resultEl.innerHTML = '<div class="card"><p class="empty">Simulating scenario... This may take a moment.</p></div>';

    var body = {};
    if (scenarioId) {
        body.scenario_id = scenarioId;
    } else {
        var custom = document.getElementById('custom-scenario').value.trim();
        if (!custom) { resultEl.innerHTML = '<p class="empty">Please describe a scenario first.</p>'; return; }
        body.custom_scenario = custom;
    }

    try {
        var resp = await fetch('/api/scenarios/simulate', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('Simulation failed');
        var data = await resp.json();

        resultEl.innerHTML = '<div class="card" style="margin-top:16px">' +
            '<h3>' + escapeHtml(data.title) + '</h3>' +
            '<span class="badge">' + escapeHtml(data.category) + '</span>' +
            '<div style="margin-top:12px;white-space:pre-wrap">' + formatMarkdown(data.simulation) + '</div>' +
        '</div>';
    } catch (e) {
        resultEl.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Failed to simulate scenario. The AI service may be temporarily unavailable.</div>';
    }
}


/* --------------------------------------------------------------------------
   29. Rent Affordability Comparator
   -------------------------------------------------------------------------- */

async function loadRentComparator() {
    var container = document.getElementById('rent-compare-container');

    try {
        var resp = await fetch('/api/rent-comparator/regions', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed to load');
        var regions = await resp.json();

        var optionsHtml = regions.map(function(r) {
            return '<option value="' + escapeHtml(r.key) + '">' + escapeHtml(r.label) + '</option>';
        }).join('');

        container.innerHTML = '<h2 class="ph">Rent Comparator</h2>' +
            '<p class="pp">Compare your rent against regional averages to assess fairness. Useful when challenging a Section 13 rent increase.</p>' +
            '<div class="card">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
                    '<div><label style="font-size:13px;font-weight:600">Region</label><select id="rc-region" class="n-ta" style="min-height:auto;padding:8px">' + optionsHtml + '</select></div>' +
                    '<div><label style="font-size:13px;font-weight:600">Bedrooms</label><select id="rc-beds" class="n-ta" style="min-height:auto;padding:8px"><option value="">Any</option><option value="1">1 Bed</option><option value="2">2 Bed</option><option value="3">3 Bed</option></select></div>' +
                    '<div><label style="font-size:13px;font-weight:600">Current Rent (£/month)</label><input type="number" id="rc-current" class="n-ta" style="min-height:auto;padding:8px" placeholder="e.g. 950"></div>' +
                    '<div><label style="font-size:13px;font-weight:600">Proposed Rent (£/month, optional)</label><input type="number" id="rc-proposed" class="n-ta" style="min-height:auto;padding:8px" placeholder="Leave blank if no increase"></div>' +
                '</div>' +
                '<button class="btn btn-p" style="margin-top:12px" onclick="compareRent()">Compare</button>' +
            '</div>' +
            '<div id="rc-result"></div>';
    } catch (e) {
        container.innerHTML = '<h2 class="ph">Rent Comparator</h2><p class="empty">Failed to load.</p>';
    }
}

async function compareRent() {
    var region = document.getElementById('rc-region').value;
    var beds = document.getElementById('rc-beds').value;
    var current = parseFloat(document.getElementById('rc-current').value);
    var proposed = document.getElementById('rc-proposed').value ? parseFloat(document.getElementById('rc-proposed').value) : null;

    if (!current || current <= 0) { document.getElementById('rc-result').innerHTML = '<p class="empty">Please enter your current rent.</p>'; return; }

    var body = { region: region, current_rent_pcm: current };
    if (proposed) body.proposed_rent_pcm = proposed;
    if (beds) body.bedrooms = parseInt(beds);

    try {
        var resp = await fetch('/api/rent-comparator/compare', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('Comparison failed');
        var d = await resp.json();

        var html = '<div class="card" style="margin-top:14px">' +
            '<h3>' + escapeHtml(d.region) + ' Rent Analysis</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0;text-align:center">' +
                '<div><div style="font-size:11px;color:var(--text-secondary)">Lower Quartile</div><div style="font-size:20px;font-weight:700">£' + d.regional_lower_quartile + '</div></div>' +
                '<div><div style="font-size:11px;color:var(--text-secondary)">Median</div><div style="font-size:20px;font-weight:700;color:var(--primary)">£' + d.regional_median + '</div></div>' +
                '<div><div style="font-size:11px;color:var(--text-secondary)">Upper Quartile</div><div style="font-size:20px;font-weight:700">£' + d.regional_upper_quartile + '</div></div>' +
            '</div>';

        if (d.bedroom_average) {
            html += '<p style="font-size:13px;text-align:center;color:var(--text-secondary)">Average for ' + beds + '-bed: <strong>£' + d.bedroom_average + '/month</strong></p>';
        }

        var vsColor = d.current_vs_median_pct > 10 ? 'var(--danger)' : d.current_vs_median_pct < -10 ? 'var(--success)' : 'var(--warning)';
        html += '<p style="margin-top:10px">Your rent (£' + d.current_rent_pcm + '): <strong style="color:' + vsColor + '">' + (d.current_vs_median_pct > 0 ? '+' : '') + d.current_vs_median_pct + '% vs median</strong></p>';

        if (d.increase_pct !== null && d.increase_pct !== undefined) {
            html += '<p>Proposed increase: <strong>' + d.increase_pct + '%</strong> (regional avg: ' + d.annual_increase_pct + '%)</p>';
        }

        html += '<div style="margin-top:12px;padding:12px;background:var(--bg-secondary);border-radius:8px">' +
            '<strong>Assessment:</strong> ' + escapeHtml(d.assessment) + '</div>' +
            '<div style="margin-top:8px;padding:12px;background:var(--bg-secondary);border-radius:8px">' +
            '<strong>Tribunal Guidance:</strong> ' + escapeHtml(d.tribunal_advice) + '</div>' +
            '<p style="font-size:11px;color:var(--text-secondary);margin-top:8px">Source: ' + escapeHtml(d.source) + '</p>' +
        '</div>';

        document.getElementById('rc-result').innerHTML = html;
    } catch (e) {
        document.getElementById('rc-result').innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Comparison failed. Please try again.</div>';
    }
}


/* --------------------------------------------------------------------------
   30. Dispute Strength Assessor
   -------------------------------------------------------------------------- */

async function loadDisputeAssessor() {
    var container = document.getElementById('dispute-assess-container');
    container.innerHTML = '<h2 class="ph">Case Strength Assessor</h2><p class="pp">Analyses your evidence, timeline, and correspondence to score your dispute readiness.</p><div id="assess-result"><p class="empty">Analysing your case...</p></div>';

    try {
        var resp = await fetch('/api/dispute-assessor', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Assessment failed');
        var d = await resp.json();

        var gradeColor = d.overall_score >= 80 ? 'var(--success)' : d.overall_score >= 60 ? 'var(--warning)' : 'var(--danger)';

        var html = '<div class="card" style="text-align:center;margin-bottom:16px">' +
            '<div style="font-size:48px;font-weight:700;color:' + gradeColor + '">' + d.overall_score + '%</div>' +
            '<div style="font-size:18px;font-weight:600">' + escapeHtml(d.grade) + '</div>' +
            '<p style="margin-top:8px;color:var(--text-secondary)">' + escapeHtml(d.summary) + '</p>' +
        '</div>';

        /* Dimension breakdown */
        html += '<div class="sec">Score Breakdown</div>';
        d.dimensions.forEach(function(dim) {
            var barColor = dim.score >= 70 ? 'var(--success)' : dim.score >= 40 ? 'var(--warning)' : 'var(--danger)';
            html += '<div class="card" style="margin-bottom:8px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                    '<strong>' + escapeHtml(dim.dimension) + '</strong>' +
                    '<span style="font-weight:700;color:' + barColor + '">' + dim.score + '%</span>' +
                '</div>' +
                '<div class="pbar" style="margin:8px 0"><div class="pfill" style="width:' + dim.score + '%;background:' + barColor + '"></div></div>' +
                '<p style="font-size:12px;color:var(--text-secondary)">' + dim.items_found + ' items found — ' + escapeHtml(dim.recommendation) + '</p>' +
            '</div>';
        });

        /* Strengths & weaknesses */
        if (d.strengths.length) {
            html += '<div class="sec" style="margin-top:14px">Strengths</div>';
            d.strengths.forEach(function(s) { html += '<div class="badge" style="background:rgba(39,134,74,0.1);color:var(--success);margin:2px">' + escapeHtml(s) + '</div>'; });
        }
        if (d.weaknesses.length) {
            html += '<div class="sec" style="margin-top:14px">Areas to Improve</div>';
            d.weaknesses.forEach(function(w) { html += '<div class="badge" style="background:rgba(192,57,43,0.1);color:var(--danger);margin:2px">' + escapeHtml(w) + '</div>'; });
        }

        /* Next steps */
        if (d.next_steps.length) {
            html += '<div class="sec" style="margin-top:14px">Recommended Next Steps</div><ol style="padding-left:18px">';
            d.next_steps.forEach(function(step) { html += '<li style="margin-bottom:6px">' + escapeHtml(step) + '</li>'; });
            html += '</ol>';
        }

        document.getElementById('assess-result').innerHTML = html;
    } catch (e) {
        document.getElementById('assess-result').innerHTML = '<p class="empty">Failed to assess case strength.</p>';
    }
}


/* --------------------------------------------------------------------------
   31. Document Vault with Versioning
   -------------------------------------------------------------------------- */

async function loadDocumentVault() {
    var container = document.getElementById('vault-container');
    container.innerHTML = '<h2 class="ph">Document Vault</h2><p class="pp">Store and version important housing documents.</p><div id="vault-actions"></div><div id="vault-list"><p class="empty">Loading...</p></div>';

    try {
        var typesResp = await fetch('/api/vault/types', { headers: getAuthHeaders() });
        var types = typesResp.ok ? await typesResp.json() : [];

        var optionsHtml = types.map(function(t) { return '<option value="' + escapeHtml(t.key) + '">' + escapeHtml(t.label) + '</option>'; }).join('');

        document.getElementById('vault-actions').innerHTML = '<div class="card" style="margin-bottom:14px">' +
            '<h4>Add Document</h4>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">' +
                '<select id="vault-type" class="n-ta" style="min-height:auto;padding:8px">' + optionsHtml + '</select>' +
                '<input type="text" id="vault-title" class="n-ta" style="min-height:auto;padding:8px" placeholder="Document title">' +
            '</div>' +
            '<textarea id="vault-desc" class="n-ta" style="min-height:60px;margin-top:8px" placeholder="Description or notes (optional)"></textarea>' +
            '<textarea id="vault-content" class="n-ta" style="min-height:80px;margin-top:8px" placeholder="Paste document text here (optional)"></textarea>' +
            '<button class="btn btn-p" style="margin-top:8px" onclick="addVaultDocument()">Save to Vault</button>' +
        '</div>';

        var resp = await fetch('/api/vault', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var data = await resp.json();

        if (!data.documents.length) {
            document.getElementById('vault-list').innerHTML = '<p class="empty">No documents yet. Add your first document above.</p>';
            return;
        }

        var html = '<div class="sec">Your Documents (' + data.total + ')</div>';
        data.documents.forEach(function(doc) {
            html += '<div class="card" style="margin-bottom:8px">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                    '<div><strong>' + escapeHtml(doc.title) + '</strong><span class="badge" style="margin-left:8px">' + escapeHtml(doc.doc_type_label) + '</span></div>' +
                    '<span style="font-size:12px;color:var(--text-secondary)">v' + doc.version + '</span>' +
                '</div>' +
                (doc.description ? '<p style="font-size:13px;color:var(--text-secondary);margin-top:4px">' + escapeHtml(doc.description) + '</p>' : '') +
                '<div style="display:flex;gap:8px;margin-top:8px">' +
                    '<button class="btn btn-o" style="font-size:12px" onclick="viewVaultVersions(\'' + doc.version_chain_id + '\')">Version History</button>' +
                    '<button class="btn btn-o" style="font-size:12px;color:var(--danger)" onclick="deleteVaultDoc(\'' + doc.document_id + '\')">Delete</button>' +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-secondary);margin-top:6px">Added: ' + doc.created_at.split('T')[0] + '</div>' +
            '</div>';
        });

        document.getElementById('vault-list').innerHTML = html;
    } catch (e) {
        document.getElementById('vault-list').innerHTML = '<p class="empty">Failed to load document vault.</p>';
    }
}

async function addVaultDocument() {
    var docType = document.getElementById('vault-type').value;
    var title = document.getElementById('vault-title').value.trim();
    var desc = document.getElementById('vault-desc').value.trim();
    var content = document.getElementById('vault-content').value.trim();

    if (!title) { alert('Please enter a document title.'); return; }

    try {
        var body = { doc_type: docType, title: title };
        if (desc) body.description = desc;
        if (content) body.content_text = content;

        var resp = await fetch('/api/vault', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) { var err = await getResponseError(resp, 'Save failed'); alert(err); return; }

        document.getElementById('vault-title').value = '';
        document.getElementById('vault-desc').value = '';
        document.getElementById('vault-content').value = '';
        loadDocumentVault();
    } catch (e) {
        alert('Failed to save document.');
    }
}

async function viewVaultVersions(chainId) {
    try {
        var resp = await fetch('/api/vault/versions/' + chainId, { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var data = await resp.json();

        var html = '<div class="card" style="margin-top:14px"><h4>Version History — ' + escapeHtml(data.doc_type) + '</h4>';
        data.versions.forEach(function(v) {
            html += '<div style="padding:8px 0;border-bottom:1px solid var(--bg-secondary)">' +
                '<strong>v' + v.version + '</strong> — ' + escapeHtml(v.title) +
                '<span style="float:right;font-size:12px;color:var(--text-secondary)">' + v.created_at.split('T')[0] + '</span>' +
                (v.content_text ? '<p style="font-size:12px;color:var(--text-secondary);margin-top:4px">' + escapeHtml(v.content_text.substring(0, 150)) + (v.content_text.length > 150 ? '...' : '') + '</p>' : '') +
            '</div>';
        });
        html += '</div>';

        document.getElementById('vault-list').insertAdjacentHTML('afterbegin', html);
    } catch (e) {
        alert('Failed to load version history.');
    }
}

async function deleteVaultDoc(docId) {
    if (!confirm('Delete this document version?')) return;
    try {
        var resp = await fetch('/api/vault/' + docId, { method: 'DELETE', headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        loadDocumentVault();
    } catch (e) {
        alert('Failed to delete document.');
    }
}


/* --------------------------------------------------------------------------
   32. Deadline Tracker
   -------------------------------------------------------------------------- */

async function loadDeadlines() {
    var container = document.getElementById('deadlines-container');
    container.innerHTML = '<h2 class="ph">Deadline Tracker</h2><p class="pp">Upcoming deadlines auto-populated from your maintenance, compliance, and notices.</p><div id="deadline-list"><p class="empty">Loading...</p></div>';

    try {
        var resp = await fetch('/api/deadlines', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var d = await resp.json();

        if (!d.deadlines.length) {
            document.getElementById('deadline-list').innerHTML = '<p class="empty">No upcoming deadlines. Keep your case updated to auto-detect deadlines.</p>';
            return;
        }

        var summaryHtml = '<div style="display:flex;gap:12px;margin-bottom:14px">';
        if (d.overdue_count > 0) summaryHtml += '<div class="badge" style="background:rgba(192,57,43,0.15);color:var(--danger)">' + d.overdue_count + ' Overdue</div>';
        if (d.urgent_count > 0) summaryHtml += '<div class="badge" style="background:rgba(212,144,58,0.15);color:var(--warning)">' + d.urgent_count + ' Urgent</div>';
        if (d.upcoming_count > 0) summaryHtml += '<div class="badge" style="background:rgba(43,138,126,0.15);color:var(--primary)">' + d.upcoming_count + ' Upcoming</div>';
        summaryHtml += '</div>';

        var html = summaryHtml;
        d.deadlines.forEach(function(dl) {
            var borderColor = dl.urgency === 'overdue' ? 'var(--danger)' : dl.urgency === 'urgent' ? 'var(--warning)' : 'var(--primary)';
            var daysText = dl.days_remaining < 0 ? Math.abs(dl.days_remaining) + ' days overdue' : dl.days_remaining === 0 ? 'Due today' : dl.days_remaining + ' days remaining';

            html += '<div class="card" style="margin-bottom:8px;border-left:3px solid ' + borderColor + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                    '<strong>' + escapeHtml(dl.title) + '</strong>' +
                    '<span class="badge" style="font-size:11px">' + escapeHtml(dl.source) + '</span>' +
                '</div>' +
                '<p style="font-size:13px;color:var(--text-secondary);margin-top:4px">' + escapeHtml(dl.description) + '</p>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">' +
                    '<span style="font-size:13px;font-weight:600;color:' + borderColor + '">' + daysText + '</span>' +
                    '<span style="font-size:12px;color:var(--text-secondary)">' + dl.deadline_date.split('T')[0] + '</span>' +
                '</div>' +
                '<p style="font-size:12px;color:var(--text-secondary);margin-top:6px;font-style:italic">' + escapeHtml(dl.action_required) + '</p>' +
            '</div>';
        });

        document.getElementById('deadline-list').innerHTML = html;
    } catch (e) {
        document.getElementById('deadline-list').innerHTML = '<p class="empty">Failed to load deadlines.</p>';
    }
}


/* --------------------------------------------------------------------------
   33. Secure Messaging
   -------------------------------------------------------------------------- */

async function loadMessages() {
    var container = document.getElementById('messages-container');
    container.innerHTML = '<h2 class="ph">Secure Messages</h2><p class="pp">Communicate with your ' + (currentUser.role === 'landlord' ? 'tenants' : 'landlord') + ' with a full audit trail.</p><div id="msg-compose"></div><div id="msg-threads"><p class="empty">Loading...</p></div>';

    /* Show compose form */
    var composeHtml = '<div class="card" style="margin-bottom:14px">' +
        '<h4>New Message</h4>';

    if (currentUser.role === 'tenant') {
        composeHtml += '<input type="hidden" id="msg-to" value="' + escapeHtml(currentUser.landlord_id || '') + '">';
    } else {
        composeHtml += '<input type="text" id="msg-to" class="n-ta" style="min-height:auto;padding:8px;margin-top:8px" placeholder="Recipient user ID">';
    }

    composeHtml += '<input type="text" id="msg-subject" class="n-ta" style="min-height:auto;padding:8px;margin-top:8px" placeholder="Subject">' +
        '<textarea id="msg-body" class="n-ta" style="min-height:80px;margin-top:8px" placeholder="Write your message..."></textarea>' +
        '<button class="btn btn-p" style="margin-top:8px" onclick="sendSecureMessage()">Send Message</button>' +
    '</div>';

    document.getElementById('msg-compose').innerHTML = composeHtml;

    /* Load threads */
    try {
        var resp = await fetch('/api/messages/threads', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var data = await resp.json();

        if (!data.threads.length) {
            document.getElementById('msg-threads').innerHTML = '<p class="empty">No messages yet.</p>';
            return;
        }

        var html = '<div class="sec">Message Threads (' + data.total + ')</div>';
        data.threads.forEach(function(t) {
            html += '<div class="card" style="margin-bottom:8px;cursor:pointer" onclick="openThread(\'' + t.thread_id + '\')">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                    '<strong>' + escapeHtml(t.subject) + '</strong>' +
                    (t.unread_count > 0 ? '<span class="badge" style="background:var(--primary);color:white">' + t.unread_count + ' new</span>' : '') +
                '</div>' +
                '<p style="font-size:13px;color:var(--text-secondary)">' + escapeHtml(t.other_party_name) + ' (' + t.other_party_role + ') — ' + t.message_count + ' messages</p>' +
                '<div style="font-size:11px;color:var(--text-secondary)">' + t.last_message_at.split('T')[0] + '</div>' +
            '</div>';
        });

        document.getElementById('msg-threads').innerHTML = html;
    } catch (e) {
        document.getElementById('msg-threads').innerHTML = '<p class="empty">Failed to load messages.</p>';
    }
}

async function sendSecureMessage(threadId) {
    var to = document.getElementById('msg-to').value.trim();
    var subject = document.getElementById('msg-subject').value.trim();
    var body = document.getElementById('msg-body').value.trim();

    if (!to || !subject || !body) { alert('Please fill in all fields.'); return; }

    var payload = { recipient_id: to, subject: subject, body: body };
    if (threadId) payload.thread_id = threadId;

    try {
        var resp = await fetch('/api/messages', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        if (!resp.ok) { var err = await getResponseError(resp, 'Send failed'); alert(err); return; }

        document.getElementById('msg-subject').value = '';
        document.getElementById('msg-body').value = '';
        loadMessages();
    } catch (e) {
        alert('Failed to send message.');
    }
}

async function openThread(threadId) {
    var container = document.getElementById('msg-threads');
    container.innerHTML = '<p class="empty">Loading thread...</p>';

    try {
        var resp = await fetch('/api/messages/threads/' + threadId, { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var data = await resp.json();

        var html = '<div style="margin-bottom:10px"><button class="btn btn-o" onclick="loadMessages()">Back to threads</button></div>' +
            '<h3>' + escapeHtml(data.subject) + '</h3>';

        data.messages.forEach(function(m) {
            var isMe = m.sender_id === currentUser.id;
            html += '<div class="card" style="margin-bottom:8px;border-left:3px solid ' + (isMe ? 'var(--primary)' : 'var(--bg-secondary)') + '">' +
                '<div style="display:flex;justify-content:space-between">' +
                    '<strong>' + escapeHtml(m.sender_name) + '</strong>' +
                    '<span style="font-size:11px;color:var(--text-secondary)">' + m.created_at.replace('T', ' ').substring(0, 16) + '</span>' +
                '</div>' +
                '<p style="margin-top:6px;white-space:pre-wrap">' + escapeHtml(m.body) + '</p>' +
            '</div>';
        });

        /* Reply form */
        html += '<div class="card" style="margin-top:12px">' +
            '<textarea id="reply-body" class="n-ta" style="min-height:60px" placeholder="Write a reply..."></textarea>' +
            '<button class="btn btn-p" style="margin-top:8px" onclick="replyToThread(\'' + threadId + '\',\'' + escapeHtml(data.subject) + '\')">Reply</button>' +
        '</div>';

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p class="empty">Failed to load thread.</p>';
    }
}

async function replyToThread(threadId, subject) {
    var body = document.getElementById('reply-body').value.trim();
    if (!body) { alert('Please write a reply.'); return; }

    /* Determine recipient from the thread */
    try {
        var resp = await fetch('/api/messages/threads/' + threadId, { headers: getAuthHeaders() });
        var data = resp.ok ? await resp.json() : null;
        if (!data || !data.messages.length) throw new Error('Thread not found');

        /* Find the other party */
        var otherMsg = data.messages.find(function(m) { return m.sender_id !== currentUser.id; });
        var recipientId = otherMsg ? otherMsg.sender_id : data.messages[0].recipient_id;

        var sendResp = await fetch('/api/messages', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ recipient_id: recipientId, subject: subject, body: body, thread_id: threadId })
        });
        if (!sendResp.ok) throw new Error('Send failed');

        openThread(threadId);
    } catch (e) {
        alert('Failed to send reply.');
    }
}


/* --------------------------------------------------------------------------
   34. Emergency Panic Button
   -------------------------------------------------------------------------- */

async function loadEmergencyPage() {
    var container = document.getElementById('emergency-container');

    try {
        var resp = await fetch('/api/emergency/types', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var types = await resp.json();

        var html = '<h2 class="ph" style="color:var(--danger)">Emergency Help</h2>' +
            '<p class="pp">If you\'re in an emergency housing situation, press the relevant button below. This will create a timestamped evidence record and provide immediate guidance.</p>' +
            '<div class="grid" style="margin-top:16px">';

        types.forEach(function(t) {
            var isC = t.urgency === 'critical';
            html += '<div class="card" style="border:2px solid ' + (isC ? 'var(--danger)' : 'var(--warning)') + ';cursor:pointer;text-align:center" onclick="activatePanic(\'' + t.key + '\')">' +
                '<div style="font-size:32px;margin-bottom:8px">' + (isC ? '🚨' : '⚠️') + '</div>' +
                '<h4>' + escapeHtml(t.label) + '</h4>' +
                '<span class="badge" style="background:' + (isC ? 'rgba(192,57,43,0.15);color:var(--danger)' : 'rgba(212,144,58,0.15);color:var(--warning)') + '">' + t.urgency + '</span>' +
            '</div>';
        });

        html += '</div><div id="emergency-result"></div>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<h2 class="ph">Emergency Help</h2><p class="empty">Failed to load emergency options.</p>';
    }
}

async function activatePanic(emergencyType) {
    var desc = prompt('Briefly describe what is happening (optional):');
    var resultEl = document.getElementById('emergency-result');
    resultEl.innerHTML = '<div class="card"><p class="empty">Recording emergency...</p></div>';

    var body = { emergency_type: emergencyType };
    if (desc) body.description = desc;

    try {
        var resp = await fetch('/api/emergency/activate', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('Failed');
        var d = await resp.json();

        var html = '<div class="card" style="margin-top:16px;border:2px solid var(--danger)">' +
            '<h3 style="color:var(--danger)">' + escapeHtml(d.label) + '</h3>' +
            '<p style="font-size:12px;color:var(--text-secondary)">Recorded at: ' + d.timestamp.replace('T', ' ').substring(0, 19) + ' (evidence ID: ' + d.evidence_id + ')</p>' +
            '<div class="sec" style="margin-top:12px">Immediate Steps</div><ol>';

        d.immediate_steps.forEach(function(step) { html += '<li style="margin-bottom:6px;font-weight:500">' + escapeHtml(step) + '</li>'; });
        html += '</ol>';

        html += '<div class="sec" style="margin-top:12px">Your Legal Position</div>' +
            '<p>' + escapeHtml(d.legal_position) + '</p>';

        html += '<div class="sec" style="margin-top:12px">Emergency Contacts</div>';
        d.contacts.forEach(function(c) {
            html += '<div style="padding:8px 0;border-bottom:1px solid var(--bg-secondary)">' +
                '<strong>' + escapeHtml(c.name) + '</strong> — <span style="font-size:18px;font-weight:700;color:var(--primary)">' + escapeHtml(c.number) + '</span>' +
                '<div style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(c.note) + '</div>' +
            '</div>';
        });

        html += '<p style="margin-top:12px;font-size:13px;color:var(--success)">' + escapeHtml(d.message) + '</p></div>';
        resultEl.innerHTML = html;
    } catch (e) {
        resultEl.innerHTML = '<div class="card" style="border-left:3px solid var(--danger)">Failed to record emergency. If you are in danger, call 999 immediately.</div>';
    }
}


/* --------------------------------------------------------------------------
   35. Compliance Reminders (Landlord)
   -------------------------------------------------------------------------- */

async function loadReminders() {
    var container = document.getElementById('reminders-container');
    container.innerHTML = '<h2 class="ph">Compliance Reminders</h2><p class="pp">Set up reminders for certificate renewals and compliance deadlines.</p><div id="reminder-form"></div><div id="reminder-list"><p class="empty">Loading...</p></div>';

    try {
        var typesResp = await fetch('/api/reminders/types', { headers: getAuthHeaders() });
        var types = typesResp.ok ? await typesResp.json() : [];

        var optionsHtml = types.map(function(t) { return '<option value="' + escapeHtml(t.key) + '">' + escapeHtml(t.label) + ' (' + t.default_lead_days + ' days notice)</option>'; }).join('');

        document.getElementById('reminder-form').innerHTML = '<div class="card" style="margin-bottom:14px">' +
            '<h4>Add Reminder</h4>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">' +
                '<select id="rem-type" class="n-ta" style="min-height:auto;padding:8px">' + optionsHtml + '</select>' +
                '<input type="date" id="rem-expiry" class="n-ta" style="min-height:auto;padding:8px">' +
            '</div>' +
            '<input type="text" id="rem-address" class="n-ta" style="min-height:auto;padding:8px;margin-top:8px" placeholder="Property address (optional)">' +
            '<textarea id="rem-notes" class="n-ta" style="min-height:50px;margin-top:8px" placeholder="Notes (optional)"></textarea>' +
            '<button class="btn btn-p" style="margin-top:8px" onclick="addReminder()">Set Reminder</button>' +
        '</div>';

        var resp = await fetch('/api/reminders', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var data = await resp.json();

        if (!data.reminders.length) {
            document.getElementById('reminder-list').innerHTML = '<p class="empty">No reminders set. Add your first reminder above.</p>';
            return;
        }

        var html = '<div class="sec">Your Reminders (' + data.total + ')';
        if (data.expiring_soon > 0) html += ' — <span style="color:var(--warning)">' + data.expiring_soon + ' expiring within 30 days</span>';
        html += '</div>';

        data.reminders.forEach(function(r) {
            var borderColor = r.status === 'expired' ? 'var(--danger)' : r.status === 'triggered' ? 'var(--warning)' : 'var(--success)';
            var daysText = r.days_until_expiry < 0 ? Math.abs(r.days_until_expiry) + ' days expired' : r.days_until_expiry + ' days until expiry';

            html += '<div class="card" style="margin-bottom:8px;border-left:3px solid ' + borderColor + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:center">' +
                    '<strong>' + escapeHtml(r.title) + '</strong>' +
                    '<span class="badge">' + escapeHtml(r.status) + '</span>' +
                '</div>' +
                (r.property_address ? '<p style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(r.property_address) + '</p>' : '') +
                '<div style="display:flex;justify-content:space-between;margin-top:8px">' +
                    '<span style="color:' + borderColor + ';font-weight:600">' + daysText + '</span>' +
                    '<span style="font-size:12px;color:var(--text-secondary)">Expires: ' + r.expiry_date + '</span>' +
                '</div>' +
                '<button class="btn btn-o" style="font-size:12px;margin-top:8px;color:var(--danger)" onclick="deleteReminder(\'' + r.reminder_id + '\')">Remove</button>' +
            '</div>';
        });

        document.getElementById('reminder-list').innerHTML = html;
    } catch (e) {
        document.getElementById('reminder-list').innerHTML = '<p class="empty">Failed to load reminders.</p>';
    }
}

async function addReminder() {
    var rType = document.getElementById('rem-type').value;
    var expiry = document.getElementById('rem-expiry').value;
    var address = document.getElementById('rem-address').value.trim();
    var notes = document.getElementById('rem-notes').value.trim();

    if (!expiry) { alert('Please select an expiry date.'); return; }

    var body = { reminder_type: rType, expiry_date: expiry };
    if (address) body.property_address = address;
    if (notes) body.notes = notes;

    try {
        var resp = await fetch('/api/reminders', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) { var err = await getResponseError(resp, 'Failed'); alert(err); return; }

        document.getElementById('rem-expiry').value = '';
        document.getElementById('rem-address').value = '';
        document.getElementById('rem-notes').value = '';
        loadReminders();
    } catch (e) {
        alert('Failed to create reminder.');
    }
}

async function deleteReminder(remId) {
    if (!confirm('Delete this reminder?')) return;
    try {
        var resp = await fetch('/api/reminders/' + remId, { method: 'DELETE', headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        loadReminders();
    } catch (e) {
        alert('Failed to delete reminder.');
    }
}


/* --------------------------------------------------------------------------
   36. Landlord Reputation Score
   -------------------------------------------------------------------------- */

async function loadReputation() {
    var container = document.getElementById('reputation-container');
    container.innerHTML = '<h2 class="ph">Reputation Score</h2><p class="pp">Your landlord reputation based on compliance, maintenance response, and task management.</p><div id="rep-result"><p class="empty">Calculating score...</p></div>';

    try {
        var resp = await fetch('/api/reputation/my/score', { headers: getAuthHeaders() });
        if (!resp.ok) throw new Error('Failed');
        var d = await resp.json();

        var gradeColor = d.overall_score >= 80 ? 'var(--success)' : d.overall_score >= 60 ? 'var(--warning)' : 'var(--danger)';

        var html = '<div class="card" style="text-align:center;margin-bottom:16px">' +
            '<div style="font-size:56px;font-weight:700;color:' + gradeColor + '">' + d.grade + '</div>' +
            '<div style="font-size:24px;font-weight:600">' + d.overall_score + ' / 100</div>' +
            '<p style="color:var(--text-secondary);margin-top:4px">' + d.total_tenants + ' active tenant' + (d.total_tenants !== 1 ? 's' : '') + '</p>' +
        '</div>';

        html += '<div class="sec">Score Breakdown</div>';
        d.breakdown.forEach(function(b) {
            var barColor = b.score >= 75 ? 'var(--success)' : b.score >= 50 ? 'var(--warning)' : 'var(--danger)';
            html += '<div class="card" style="margin-bottom:8px">' +
                '<div style="display:flex;justify-content:space-between">' +
                    '<strong>' + escapeHtml(b.category) + '</strong>' +
                    '<span style="font-weight:700;color:' + barColor + '">' + b.score + '%</span>' +
                '</div>' +
                '<div class="pbar" style="margin:8px 0"><div class="pfill" style="width:' + b.score + '%;background:' + barColor + '"></div></div>' +
                '<p style="font-size:12px;color:var(--text-secondary)">' + escapeHtml(b.detail) + '</p>' +
            '</div>';
        });

        document.getElementById('rep-result').innerHTML = html;
    } catch (e) {
        document.getElementById('rep-result').innerHTML = '<p class="empty">Failed to calculate reputation score.</p>';
    }
}


/* --------------------------------------------------------------------------
   37. Auto-boot (resume session if token exists)
   -------------------------------------------------------------------------- */

/* Load translations on startup, then boot if logged in */
(async function() {
    await loadLanguage(currentLang);
    if (authToken && currentUser) {
        boot();
    }
})();
