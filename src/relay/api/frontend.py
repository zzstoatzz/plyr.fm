"""frontend html pages."""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["frontend"])


@router.get("/portal", response_class=HTMLResponse)
async def artist_portal() -> str:
    """artist upload portal with authentication."""
    return """
<!DOCTYPE html>
<html>
<head>
    <title>relay - artist portal</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: #0a0a0a;
            color: #e0e0e0;
        }
        h1 { margin-bottom: 10px; color: #fff; }

        nav {
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 1px solid #333;
        }

        nav a {
            color: #3a7dff;
            text-decoration: none;
            font-size: 14px;
        }

        nav a:hover { text-decoration: underline; }
        
        .upload-section {
            background: #1a1a1a;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        
        .upload-section h2 { margin-bottom: 15px; font-size: 18px; }
        
        input, button {
            display: block;
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            border: 1px solid #333;
            border-radius: 4px;
            background: #2a2a2a;
            color: #e0e0e0;
            font-size: 14px;
        }
        
        button {
            background: #3a7dff;
            color: white;
            border: none;
            cursor: pointer;
            font-weight: 500;
        }
        
        button:hover { background: #2d6ee6; }
        button:disabled { background: #555; cursor: not-allowed; }
        
        .tracks-section h2 { margin-bottom: 15px; font-size: 18px; }
        
        .track {
            background: #1a1a1a;
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .track:hover { background: #252525; }
        .track.playing { background: #2a3f5f; }
        
        .track-title { font-weight: 500; margin-bottom: 5px; }
        .track-artist { color: #888; font-size: 14px; }
        
        .player {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #1a1a1a;
            border-top: 1px solid #333;
            padding: 15px;
            display: none;
        }
        
        .player.active { display: block; }
        
        .player-info {
            margin-bottom: 10px;
            text-align: center;
        }
        
        .player-title { font-weight: 500; }
        .player-artist { color: #888; font-size: 14px; }
        
        audio {
            width: 100%;
            margin-top: 10px;
        }
        
        .status { 
            padding: 10px; 
            margin-bottom: 10px; 
            border-radius: 4px;
            display: none;
        }
        .status.success { background: #1a4d1a; display: block; }
        .status.error { background: #4d1a1a; display: block; }
    </style>
</head>
<body>
    <h1>relay - artist portal</h1>
    <nav>
        <a href="/">← back to tracks</a>
        <span id="userInfo" style="display:none; margin-left: 10px;"></span>
        <button id="logoutBtn" style="display:none; margin-left: 10px;">logout</button>
    </nav>

    <div id="loginSection" class="upload-section">
        <h2>authenticate with bluesky</h2>
        <p style="color: #888; margin-bottom: 15px;">login with your bluesky handle and app password to upload tracks.</p>
        <div id="loginStatus" class="status"></div>
        <form id="loginForm">
            <input type="text" id="handle" placeholder="your.handle.bsky.social" required>
            <input type="password" id="appPassword" placeholder="app password" required>
            <button type="submit">login</button>
        </form>
        <p style="color: #666; margin-top: 15px; font-size: 12px;">
            get an app password from your <a href="https://bsky.app/settings/app-passwords" target="_blank" style="color: #3a7dff;">bluesky settings</a>
        </p>
    </div>

    <div id="uploadSection" class="upload-section" style="display:none;">
        <h2>upload track</h2>
        <div id="uploadStatus" class="status"></div>
        <form id="uploadForm">
            <input type="text" id="title" placeholder="title" required>
            <input type="text" id="artist" placeholder="artist" required>
            <input type="text" id="album" placeholder="album (optional)">
            <input type="file" id="file" accept=".mp3,.wav,.m4a" required>
            <button type="submit">upload</button>
        </form>
    </div>
    
    <div class="tracks-section">
        <h2>tracks</h2>
        <div id="tracks"></div>
    </div>
    
    <div class="player" id="player">
        <div class="player-info">
            <div class="player-title" id="playerTitle"></div>
            <div class="player-artist" id="playerArtist"></div>
        </div>
        <audio id="audio" controls></audio>
    </div>
    
    <script>
        let currentTrackId = null;
        let isAuthenticated = false;

        // check if user is authenticated
        async function checkAuth() {
            try {
                const response = await fetch('/auth/me');
                if (response.ok) {
                    const user = await response.json();
                    isAuthenticated = true;
                    document.getElementById('loginSection').style.display = 'none';
                    document.getElementById('uploadSection').style.display = 'block';
                    document.getElementById('userInfo').style.display = 'inline';
                    document.getElementById('userInfo').textContent = `@${user.handle}`;
                    document.getElementById('logoutBtn').style.display = 'inline';
                } else {
                    isAuthenticated = false;
                    document.getElementById('loginSection').style.display = 'block';
                    document.getElementById('uploadSection').style.display = 'none';
                    document.getElementById('userInfo').style.display = 'none';
                    document.getElementById('logoutBtn').style.display = 'none';
                }
            } catch (err) {
                console.error('auth check failed:', err);
            }
        }

        // handle login
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const form = e.target;
            const button = form.querySelector('button');
            const status = document.getElementById('loginStatus');

            button.disabled = true;
            button.textContent = 'logging in...';
            status.className = 'status';

            const formData = new FormData();
            formData.append('handle', document.getElementById('handle').value);
            formData.append('app_password', document.getElementById('appPassword').value);

            try {
                const response = await fetch('/auth/login', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    status.className = 'status success';
                    status.textContent = 'logged in successfully!';
                    form.reset();
                    await checkAuth();
                } else {
                    const error = await response.json();
                    status.className = 'status error';
                    status.textContent = `error: ${error.detail}`;
                }
            } catch (err) {
                status.className = 'status error';
                status.textContent = `error: ${err.message}`;
            } finally {
                button.disabled = false;
                button.textContent = 'login';
            }
        });

        // handle logout
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            try {
                await fetch('/auth/logout', { method: 'POST' });
                isAuthenticated = false;
                await checkAuth();
            } catch (err) {
                console.error('logout failed:', err);
            }
        });

        async function loadTracks() {
            const response = await fetch('/tracks');
            const data = await response.json();
            
            const tracksDiv = document.getElementById('tracks');
            tracksDiv.innerHTML = '';
            
            if (data.tracks.length === 0) {
                tracksDiv.innerHTML = '<p style="color: #666;">no tracks yet. upload one to get started.</p>';
                return;
            }
            
            data.tracks.forEach(track => {
                const trackDiv = document.createElement('div');
                trackDiv.className = 'track';
                if (currentTrackId === track.id) {
                    trackDiv.classList.add('playing');
                }
                trackDiv.innerHTML = `
                    <div class="track-title">${track.title}</div>
                    <div class="track-artist">${track.artist}${track.album ? ' - ' + track.album : ''}</div>
                `;
                trackDiv.onclick = () => playTrack(track);
                tracksDiv.appendChild(trackDiv);
            });
        }
        
        function playTrack(track) {
            currentTrackId = track.id;
            
            const player = document.getElementById('player');
            const audio = document.getElementById('audio');
            const title = document.getElementById('playerTitle');
            const artist = document.getElementById('playerArtist');
            
            title.textContent = track.title;
            artist.textContent = track.artist + (track.album ? ' - ' + track.album : '');
            audio.src = `/audio/${track.file_id}`;
            
            player.classList.add('active');
            audio.play();
            
            loadTracks();  // refresh to show playing state
        }
        
        document.getElementById('uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const form = e.target;
            const button = form.querySelector('button');
            const status = document.getElementById('uploadStatus');
            
            button.disabled = true;
            button.textContent = 'uploading...';
            status.className = 'status';
            
            const formData = new FormData();
            formData.append('title', document.getElementById('title').value);
            formData.append('artist', document.getElementById('artist').value);
            const album = document.getElementById('album').value;
            if (album) formData.append('album', album);
            formData.append('file', document.getElementById('file').files[0]);
            
            try {
                const response = await fetch('/tracks/', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    status.className = 'status success';
                    status.textContent = 'track uploaded successfully!';
                    form.reset();
                    await loadTracks();
                } else {
                    const error = await response.json();
                    status.className = 'status error';
                    status.textContent = `error: ${error.detail}`;
                }
            } catch (err) {
                status.className = 'status error';
                status.textContent = `error: ${err.message}`;
            } finally {
                button.disabled = false;
                button.textContent = 'upload';
            }
        });

        // initialize on page load
        checkAuth();
        loadTracks();
    </script>
</body>
</html>
    """


@router.get("/", response_class=HTMLResponse)
async def index() -> str:
    """landing page with track discovery."""
    return """
<!DOCTYPE html>
<html>
<head>
    <title>relay - decentralized music</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            background: #0a0a0a;
            color: #e0e0e0;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 1px solid #333;
        }

        h1 {
            color: #fff;
            font-size: 32px;
        }

        .portal-link {
            background: #3a7dff;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            transition: background 0.2s;
        }

        .portal-link:hover {
            background: #2d6ee6;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #666;
        }

        .empty-state h2 {
            font-size: 20px;
            margin-bottom: 10px;
            color: #888;
        }

        .tracks-section h2 {
            margin-bottom: 20px;
            font-size: 18px;
            color: #aaa;
        }

        .track {
            background: #1a1a1a;
            padding: 20px;
            margin-bottom: 12px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
            border-left: 3px solid transparent;
        }

        .track:hover {
            background: #252525;
            transform: translateX(2px);
            border-left-color: #3a7dff;
        }

        .track.playing {
            background: #2a3f5f;
            border-left-color: #3a7dff;
        }

        .track-title {
            font-weight: 500;
            font-size: 16px;
            margin-bottom: 6px;
            color: #fff;
        }

        .track-artist {
            color: #888;
            font-size: 14px;
        }

        .player {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #1a1a1a;
            border-top: 1px solid #333;
            padding: 20px;
            display: none;
            box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.5);
        }

        .player.active { display: block; }

        .player-info {
            max-width: 900px;
            margin: 0 auto 15px;
            text-align: center;
        }

        .player-title {
            font-weight: 500;
            font-size: 16px;
            color: #fff;
        }

        .player-artist {
            color: #888;
            font-size: 14px;
            margin-top: 4px;
        }

        audio {
            width: 100%;
            max-width: 900px;
            display: block;
            margin: 0 auto;
        }
    </style>
</head>
<body>
    <header>
        <h1>relay</h1>
        <a href="/portal" class="portal-link">artist portal →</a>
    </header>

    <div class="tracks-section">
        <h2>latest tracks</h2>
        <div id="tracks"></div>
    </div>

    <div class="player" id="player">
        <div class="player-info">
            <div class="player-title" id="playerTitle"></div>
            <div class="player-artist" id="playerArtist"></div>
        </div>
        <audio id="audio" controls></audio>
    </div>

    <script>
        let currentTrackId = null;

        async function loadTracks() {
            const response = await fetch('/tracks');
            const data = await response.json();

            const tracksDiv = document.getElementById('tracks');
            tracksDiv.innerHTML = '';

            if (data.tracks.length === 0) {
                tracksDiv.innerHTML = `
                    <div class="empty-state">
                        <h2>no tracks yet</h2>
                        <p>be the first to share music on relay</p>
                    </div>
                `;
                return;
            }

            data.tracks.forEach(track => {
                const trackDiv = document.createElement('div');
                trackDiv.className = 'track';
                if (currentTrackId === track.id) {
                    trackDiv.classList.add('playing');
                }
                trackDiv.innerHTML = `
                    <div class="track-title">${track.title}</div>
                    <div class="track-artist">${track.artist}${track.album ? ' - ' + track.album : ''}</div>
                `;
                trackDiv.onclick = () => playTrack(track);
                tracksDiv.appendChild(trackDiv);
            });
        }

        function playTrack(track) {
            currentTrackId = track.id;

            const player = document.getElementById('player');
            const audio = document.getElementById('audio');
            const title = document.getElementById('playerTitle');
            const artist = document.getElementById('playerArtist');

            title.textContent = track.title;
            artist.textContent = track.artist + (track.album ? ' - ' + track.album : '');
            audio.src = `/audio/${track.file_id}`;

            player.classList.add('active');
            audio.play();

            loadTracks();  // refresh to show playing state
        }

        // load tracks on page load
        loadTracks();
    </script>
</body>
</html>
    """
