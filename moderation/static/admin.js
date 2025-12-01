// Set up auth header listener first (before any htmx requests)
let currentToken = null;

document.body.addEventListener('htmx:configRequest', function(evt) {
    if (currentToken) {
        evt.detail.headers['X-Moderation-Key'] = currentToken;
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
        htmx.trigger('#flags-list', 'load');
    }
}

// Check for saved token on load
const savedToken = localStorage.getItem('mod_token');
if (savedToken) {
    document.getElementById('auth-token').value = '••••••••';
    currentToken = savedToken;
    showMain();
    // Trigger load after DOM is ready and htmx is initialized
    setTimeout(() => htmx.trigger('#flags-list', 'load'), 0);
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

    // Submit via fetch
    const formData = new FormData();
    formData.append('uri', uri);
    formData.append('val', val);
    formData.append('reason', reason);

    fetch('/admin/resolve-htmx', {
        method: 'POST',
        headers: {
            'X-Moderation-Key': currentToken
        },
        body: formData
    })
    .then(response => {
        if (response.ok) {
            // Trigger refresh of flags list
            htmx.trigger('#flags-list', 'flagsUpdated');
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
    })
    .catch(err => {
        showToast('failed to resolve: ' + err.message, 'error');
        cancelResolve(btn);
    });
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
