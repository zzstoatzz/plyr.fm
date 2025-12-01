// Check for saved token on load
const savedToken = localStorage.getItem('mod_token');
if (savedToken) {
    document.getElementById('auth-token').value = '••••••••';
    showMain();
    setAuthHeader(savedToken);
}

function authenticate() {
    const token = document.getElementById('auth-token').value;
    if (token && token !== '••••••••') {
        localStorage.setItem('mod_token', token);
        setAuthHeader(token);
        showMain();
        htmx.trigger('#flags-list', 'load');
    }
}

function showMain() {
    document.getElementById('main-content').style.display = 'block';
}

function setAuthHeader(token) {
    document.body.addEventListener('htmx:configRequest', function(evt) {
        evt.detail.headers['X-Moderation-Key'] = token;
    });
}

// Handle auth errors
document.body.addEventListener('htmx:responseError', function(evt) {
    if (evt.detail.xhr.status === 401) {
        localStorage.removeItem('mod_token');
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
