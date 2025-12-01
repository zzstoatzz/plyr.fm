// Set up auth header listener first (before any htmx requests)
let currentToken = null;

document.body.addEventListener('htmx:configRequest', function(evt) {
    if (currentToken) {
        evt.detail.headers['X-Moderation-Key'] = currentToken;
    }
});

// Check for saved token on load
const savedToken = localStorage.getItem('mod_token');
if (savedToken) {
    document.getElementById('auth-token').value = '••••••••';
    currentToken = savedToken;
    showMain();
    // Trigger load after DOM is ready and htmx is initialized
    setTimeout(() => htmx.trigger('#flags-list', 'load'), 0);
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

function showMain() {
    document.getElementById('main-content').style.display = 'block';
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

// Dropdown toggle for reason selection
function toggleDropdown(btn) {
    const dropdown = btn.closest('.resolve-dropdown');
    const wasOpen = dropdown.classList.contains('open');

    // Close all dropdowns first
    document.querySelectorAll('.resolve-dropdown.open').forEach(d => d.classList.remove('open'));

    // Toggle this one
    if (!wasOpen) {
        dropdown.classList.add('open');
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(evt) {
    if (!evt.target.closest('.resolve-dropdown')) {
        document.querySelectorAll('.resolve-dropdown.open').forEach(d => d.classList.remove('open'));
    }
});

// Close dropdowns after form submission
document.body.addEventListener('htmx:afterRequest', function(evt) {
    document.querySelectorAll('.resolve-dropdown.open').forEach(d => d.classList.remove('open'));
});
