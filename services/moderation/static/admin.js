// Set up auth header listener first (before any htmx requests)
let currentToken = null;
let currentFilter = 'pending'; // track current filter state for flags
let currentReportStatus = 'open'; // track current status filter for reports
let currentTab = 'copyright'; // track current tab
let reportsLoaded = false; // track if reports have been loaded

document.body.addEventListener('htmx:configRequest', function(evt) {
    if (currentToken) {
        evt.detail.headers['X-Moderation-Key'] = currentToken;
    }
});

// Track filter changes via htmx
document.body.addEventListener('htmx:afterRequest', function(evt) {
    const url = evt.detail.pathInfo?.requestPath || '';
    // Track flags filter
    const filterMatch = url.match(/filter=(\w+)/);
    if (filterMatch) {
        currentFilter = filterMatch[1];
    }
    // Track reports status filter
    const statusMatch = url.match(/status=(\w+)/);
    if (statusMatch) {
        currentReportStatus = statusMatch[1];
    }
});

function showMain() {
    document.getElementById('main-content').style.display = 'block';
}

function authenticate() {
    const token = document.getElementById('auth-token').value;
    if (token && token !== '••••••••') {
        localStorage.setItem('mod_token', token);
        currentToken = token;
        showMain();
        loadQueue();
    }
}

// Check for saved token on load
const savedToken = localStorage.getItem('mod_token');
if (savedToken) {
    document.getElementById('auth-token').value = '••••••••';
    currentToken = savedToken;
    showMain();
    setTimeout(loadQueue, 0);
}

const savedActor = localStorage.getItem('mod_actor');
if (savedActor) {
    document.getElementById('actor').value = savedActor;
}

// Handle auth errors
document.body.addEventListener('htmx:responseError', function(evt) {
    if (evt.detail.xhr.status === 401) {
        localStorage.removeItem('mod_token');
        currentToken = null;
        showToast('invalid token', 'error');
    }
});

function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// Reason options for false positive resolution
const REASONS = [
    { value: 'original_artist', label: 'original artist' },
    { value: 'licensed', label: 'licensed' },
    { value: 'fingerprint_noise', label: 'fp noise' },
    { value: 'cover_version', label: 'cover/remix' },
    { value: 'other', label: 'other' }
];

// Step 1 -> Step 2: Show reason selection buttons
function showReasonSelect(btn) {
    const flow = btn.closest('.resolve-flow');

    // Replace button with reason selection
    flow.innerHTML = `
        <div class="reason-select">
            ${REASONS.map(r => `
                <button type="button" class="reason-btn" data-reason="${r.value}" onclick="selectReason(this, '${r.value}')">
                    ${r.label}
                </button>
            `).join('')}
            <button type="button" class="reason-btn cancel" onclick="cancelResolve(this)">✕</button>
        </div>
    `;
}

// Step 2 -> Step 3: Show confirmation
function selectReason(btn, reason) {
    const flow = btn.closest('.resolve-flow');
    const reasonLabel = REASONS.find(r => r.value === reason)?.label || reason;

    // Replace with confirmation
    flow.innerHTML = `
        <div class="confirm-step">
            <span class="confirm-text">resolve as <strong>${reasonLabel}</strong>?</span>
            <button type="button" class="btn btn-confirm" onclick="confirmResolve(this, '${reason}')">confirm</button>
            <button type="button" class="reason-btn cancel" onclick="cancelResolve(this)">cancel</button>
        </div>
    `;
}

// Step 3: Actually submit the resolution
function confirmResolve(btn, reason) {
    const flow = btn.closest('.resolve-flow');
    const uri = flow.dataset.uri;
    const val = flow.dataset.val;

    // Show loading state
    btn.disabled = true;
    btn.textContent = '...';

    // Submit via fetch (URLSearchParams for application/x-www-form-urlencoded)
    const params = new URLSearchParams();
    params.append('uri', uri);
    params.append('val', val);
    params.append('reason', reason);

    fetch('/admin/resolve-htmx', {
        method: 'POST',
        headers: {
            'X-Moderation-Key': currentToken,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    })
    .then(response => {
        if (response.ok) {
            return response.text();
        }
        throw new Error('Failed to resolve');
    })
    .then(html => {
        // Parse and show toast from response
        const match = html.match(/resolved: ([^<]+)/);
        if (match) {
            showToast(match[0], 'success');
        }
        // Refresh flags list with current filter
        refreshFlagsList();
    })
    .catch(err => {
        showToast('failed to resolve: ' + err.message, 'error');
        cancelResolve(btn);
    });
}

// Refresh flags list preserving current filter
function refreshFlagsList() {
    htmx.ajax('GET', `/admin/flags-html?filter=${currentFilter}`, '#flags-list');
}

// Cancel: restore original button
function cancelResolve(btn) {
    const flow = btn.closest('.resolve-flow');
    flow.innerHTML = `
        <button type="button" class="btn btn-warning" onclick="showReasonSelect(this)">
            mark false positive
        </button>
    `;
}

// Tab switching
function switchTab(tab) {
    currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === 'tab-' + tab);
    });

    // Load data for tab if needed
    if (tab === 'queue') {
        loadQueue();
    }
    if (tab === 'reports' && !reportsLoaded) {
        reportsLoaded = true;
        refreshReportsList();
    }
}

// --- review queue ---
//
// The queue the dashboard used to show read *labels*, but post-#703 a scan
// never emits one, so scan flags were invisible here — raised into a queue
// nobody could see. This reads the moderation event log instead, which is
// where both scan flags and user reports now land.

function getActor() {
    return (document.getElementById('actor')?.value || '').trim();
}

function saveActor() {
    localStorage.setItem('mod_actor', getActor());
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

async function loadQueue() {
    const list = document.getElementById('queue-list');
    list.innerHTML = '<div class="loading">loading...</div>';
    try {
        const response = await fetch('/admin/queue', {
            headers: { 'X-Moderation-Key': currentToken }
        });
        if (!response.ok) throw new Error(`${response.status}`);
        const { items } = await response.json();
        renderQueue(items || []);
    } catch (e) {
        list.innerHTML = `<div class="empty-placeholder"><p>could not load queue (${escapeHtml(e.message)})</p></div>`;
    }
}

function renderQueue(items) {
    const list = document.getElementById('queue-list');
    if (!items.length) {
        list.innerHTML = '<div class="empty-placeholder"><p>nothing awaiting review</p>'
            + '<p class="muted">scan flags and reports appear here until a decision is recorded</p></div>';
        return;
    }

    list.innerHTML = items.map((item) => {
        const uri = escapeHtml(item.subject_uri);
        const trackId = item.subject_track_id;
        const labels = (item.labels || []).map(
            (l) => `<span class="label-chip">${escapeHtml(l)}</span>`
        ).join(' ') || '<span class="muted">no labels</span>';

        // the real player, so a copyright call can be made by listening
        const player = trackId
            ? `<iframe class="queue-player" src="https://plyr.fm/embed/track/${trackId}"
                       loading="lazy" title="track ${trackId}"></iframe>`
            : '<p class="muted">no track id — cannot preview</p>';

        const link = trackId
            ? `<a href="https://plyr.fm/track/${trackId}" target="_blank" rel="noopener">open on plyr.fm</a>`
            : '';

        return `
        <div class="flag-card" data-uri="${uri}">
            <div class="flag-header">
                <strong>${trackId ? `track ${trackId}` : 'unknown track'}</strong>
                <span class="muted">opened by ${escapeHtml(item.opened_by)}
                    · ${new Date(item.opened_at).toLocaleString()}</span>
            </div>
            <div class="flag-meta">
                <div>${labels}</div>
                ${item.reason ? `<div class="muted">reason: ${escapeHtml(item.reason)}</div>` : ''}
                ${item.notes ? `<div class="muted">${escapeHtml(item.notes)}</div>` : ''}
                <div class="uri">${uri}</div>
            </div>
            ${player}
            <div class="flag-actions">
                <button class="btn btn-secondary"
                        onclick="decide('${uri}', ${trackId ?? 'null'}, 'acknowledged')">
                    acknowledge
                </button>
                <button class="btn btn-secondary"
                        onclick="decide('${uri}', ${trackId ?? 'null'}, 'override_allow')">
                    allow anyway
                </button>
                <button class="btn btn-danger"
                        onclick="decide('${uri}', ${trackId ?? 'null'}, 'override_exclude')">
                    keep de-listed
                </button>
                ${link}
            </div>
        </div>`;
    }).join('');
}

async function decide(subjectUri, trackId, action) {
    const actor = getActor();
    if (!actor) {
        showToast('set "acting as" first — decisions are attributed', 'error');
        document.getElementById('actor').focus();
        return;
    }
    const notes = prompt(`notes for "${action}" (optional)`) ?? '';
    try {
        const response = await fetch('/admin/events', {
            method: 'POST',
            headers: {
                'X-Moderation-Key': currentToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                subject_uri: subjectUri,
                subject_track_id: trackId,
                action,
                actor,
                notes: notes || null
            })
        });
        if (!response.ok) throw new Error(`${response.status}`);
        showToast(`recorded ${action}`, 'success');
        loadQueue();
    } catch (e) {
        showToast(`failed: ${e.message}`, 'error');
    }
}

// Refresh reports list
function refreshReportsList() {
    htmx.ajax('GET', `/admin/reports-html?status=${currentReportStatus}`, '#reports-list');
}

// Placeholder for sensitive images (future)
function refreshImagesList() {
    showToast('images refresh coming soon', 'success');
}

// Report action options
const REPORT_ACTIONS = [
    { value: 'resolved', label: 'resolve' },
    { value: 'dismissed', label: 'dismiss' },
    { value: 'investigating', label: 'investigating' }
];

// Show report action buttons
function showReportActions(btn) {
    const flow = btn.closest('.report-actions-flow');

    flow.innerHTML = `
        <div class="reason-select">
            ${REPORT_ACTIONS.map(a => `
                <button type="button" class="reason-btn" onclick="selectReportAction(this, '${a.value}')">
                    ${a.label}
                </button>
            `).join('')}
            <button type="button" class="reason-btn cancel" onclick="cancelReportAction(this)">✕</button>
        </div>
    `;
}

// Select report action, show notes input
function selectReportAction(btn, action) {
    const flow = btn.closest('.report-actions-flow');
    const actionLabel = REPORT_ACTIONS.find(a => a.value === action)?.label || action;

    flow.innerHTML = `
        <div class="confirm-step">
            <input type="text" class="notes-input" placeholder="admin notes (optional)" id="report-notes-${flow.dataset.id}">
            <button type="button" class="btn btn-confirm" onclick="confirmReportAction(this, '${action}')">
                ${actionLabel}
            </button>
            <button type="button" class="reason-btn cancel" onclick="cancelReportAction(this)">cancel</button>
        </div>
    `;
}

// Submit report resolution
function confirmReportAction(btn, action) {
    const flow = btn.closest('.report-actions-flow');
    const reportId = flow.dataset.id;
    const notesInput = flow.querySelector('.notes-input');
    const notes = notesInput ? notesInput.value : '';

    btn.disabled = true;
    btn.textContent = '...';

    fetch(`/admin/reports/${reportId}/resolve`, {
        method: 'POST',
        headers: {
            'X-Moderation-Key': currentToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            status: action,
            admin_notes: notes || null,
            resolved_by: 'admin' // TODO: track actual admin identity
        })
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        }
        throw new Error('Failed to resolve report');
    })
    .then(data => {
        showToast(`report ${action}`, 'success');
        refreshReportsList();
    })
    .catch(err => {
        showToast('failed: ' + err.message, 'error');
        cancelReportAction(btn);
    });
}

// Cancel report action
function cancelReportAction(btn) {
    const flow = btn.closest('.report-actions-flow');
    flow.innerHTML = `
        <button type="button" class="btn btn-secondary" onclick="showReportActions(this)">
            take action
        </button>
    `;
}
