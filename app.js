/* =====================================================
   Word Suspect – app.js
   Real-time multiplayer social deduction party game
   ===================================================== */

'use strict';

/* ─── Player Avatars ─────────────────────────────────── */
const AVATARS = ['🐼','🦊','🐸','🐯','🐺','🦁','🐻','🐨','🐧','🦋',
                 '🐙','🦄','🐬','🦅','🐲','🦝','🐮','🐷','🐸','🦀',
                 '🐝','🦩','🦚','🐠','🦎','🦔','🦜','🐿️','🦙','🦘'];

/* ─── Game Phases ─────────────────────────────────────── */
const PHASE = {
  LOBBY:      'lobby',
  DISCUSSION: 'discussion',
  VOTING:     'voting',
  RESULTS:    'results',
};

/* ─── App State ───────────────────────────────────────── */
const State = {
  db: null,
  localMode: false,
  roomCode: null,
  playerId: null,
  playerName: null,
  isHost: false,
  roomRef: null,
  roomData: null,          // latest snapshot from Firebase (or local store)
  timerInterval: null,
  timerPaused: false,
  wordRevealed: false,
  selectedVote: null,
  hasVoted: false,
  myVoteTarget: null,
  localStore: {},          // used in single-device demo mode
  listenerOff: null,       // firebase listener unsubscriber
};

/* ─── Local Mode Store ────────────────────────────────── */
// In local mode we keep a single in-memory object and re-render on writes.
function localWrite(path, value) {
  const parts = path.split('/').filter(Boolean);
  // Deep-delete if null
  if (value === null) {
    let obj = State.localStore;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) return;
      obj = obj[parts[i]];
    }
    delete obj[parts[parts.length - 1]];
  } else {
    let obj = State.localStore;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] === undefined || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  }
  // Trigger simulated listener
  _fireLocalListener();
}

function _fireLocalListener() {
  if (State.localListenerCb && State.roomCode) {
    // Deep clone to avoid mutation issues
    const data = JSON.parse(JSON.stringify(State.localStore[State.roomCode] || null));
    State.localListenerCb(data);
  }
}

function localRead(path) {
  const parts = path.split('/').filter(Boolean);
  let obj = State.localStore;
  for (const p of parts) { obj = obj?.[p]; }
  return obj !== undefined ? obj : null;
}

function localUpdate(path, updates) {
  // Write silently (no listener fires), then fire once at the end
  const silent = (p, v) => {
    const parts = p.split('/').filter(Boolean);
    if (v === null) {
      let obj = State.localStore;
      for (let i = 0; i < parts.length - 1; i++) { if (!obj[parts[i]]) return; obj = obj[parts[i]]; }
      delete obj[parts[parts.length - 1]];
    } else {
      let obj = State.localStore;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = v;
    }
  };
  for (const [key, val] of Object.entries(updates)) {
    silent(path + '/' + key, val);
  }
  _fireLocalListener();
}

/* ─── Floating Shapes Init ────────────────────────────── */
function initFloatingShapes() {
  const container = document.getElementById('floating-shapes');
  const colors = ['#a855f7','#06b6d4','#ec4899','#f59e0b','#10b981'];
  const types = ['circle','star','circle','circle','star'];
  for (let i = 0; i < 18; i++) {
    const el = document.createElement('div');
    const size = 16 + Math.random() * 40;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    el.className = `shape ${type}`;
    el.style.cssText = `
      width:${size}px;height:${size}px;
      left:${Math.random()*100}%;
      background:${color};
      animation-duration:${12 + Math.random()*18}s;
      animation-delay:${-Math.random()*20}s;
      border-bottom-color:${color};
    `;
    container.appendChild(el);
  }
}

/* ─── Notifications ───────────────────────────────────── */
function notify(msg, type = 'info') {
  const area = document.getElementById('notification');
  const div = document.createElement('div');
  div.className = `notif ${type}`;
  div.textContent = msg;
  area.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

/* ─── Screen Navigation ───────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${id}`);
  if (target) target.classList.add('active');
}

function modal(id, open) {
  const el = document.getElementById(`modal-${id}`);
  if (!el) return;
  el.classList.toggle('open', open);
}

/* ─── Room Code Generator ─────────────────────────────── */
function genCode(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/* ─── Player Avatar (deterministic per name) ──────────── */
function avatarFor(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATARS[Math.abs(hash) % AVATARS.length];
}

/* ─── Firebase / Local Bridge ─────────────────────────── */
function dbSet(path, value) {
  if (State.localMode) { localWrite(path, value); return Promise.resolve(); }
  return State.db.ref(path).set(value);
}

function dbUpdate(path, updates) {
  if (State.localMode) { localUpdate(path, updates); return Promise.resolve(); }
  return State.db.ref(path).update(updates);
}

function dbGet(path) {
  if (State.localMode) return Promise.resolve(localRead(path));
  return State.db.ref(path).get().then(s => s.val());
}

function dbPush(path, value) {
  if (State.localMode) {
    const key = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    localWrite(path + '/' + key, value);
    return Promise.resolve(key);
  }
  return State.db.ref(path).push(value).then(ref => ref.key);
}

function dbOnValue(path, cb) {
  if (State.localMode) {
    State.localListenerCb = cb;
    // Fire immediately with current data if it exists
    const parts = path.split('/').filter(Boolean);
    let current = State.localStore;
    for (const p of parts) { current = current?.[p]; }
    if (current !== undefined && current !== null) {
      cb(JSON.parse(JSON.stringify(current)));
    }
    return () => { State.localListenerCb = null; };
  }
  const ref = State.db.ref(path);
  ref.on('value', snap => cb(snap.val()));
  return () => ref.off('value');
}

function dbRemove(path) {
  if (State.localMode) { localWrite(path, null); return Promise.resolve(); }
  return State.db.ref(path).remove();
}

/* ─── Firebase Init ───────────────────────────────────── */
const App = {

  initFirebase() {
    const apiKey    = document.getElementById('fb-api-key').value.trim();
    const projectId = document.getElementById('fb-project-id').value.trim();
    const dbUrl     = document.getElementById('fb-db-url').value.trim();

    if (!apiKey || !projectId || !dbUrl) {
      notify('Please fill in all Firebase fields!', 'error');
      return;
    }

    try {
      const config = { apiKey, projectId, databaseURL: dbUrl, authDomain: `${projectId}.firebaseapp.com` };
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      State.db = firebase.database();
      // Save to localStorage for next visit
      localStorage.setItem('ws_fb_config', JSON.stringify({ apiKey, projectId, dbUrl }));
      modal('firebase', false);
      notify('🔥 Firebase connected!', 'success');
    } catch (e) {
      notify('Firebase error: ' + e.message, 'error');
    }
  },

  useLocalMode() {
    State.localMode = true;
    State.localStore = {};
    modal('firebase', false);
    notify('💻 Demo mode – single device only', 'warning');
  },

  /* ─── Home ─────────────────────────────────────────── */
  goHome() {
    if (State.listenerOff) { State.listenerOff(); State.listenerOff = null; }
    App._stopTimer();
    State.roomCode   = null;
    State.playerId   = null;
    State.isHost     = false;
    State.roomRef    = null;
    State.roomData   = null;
    State.hasVoted   = false;
    State.myVoteTarget = null;
    State.selectedVote = null;
    State.wordRevealed = false;
    showScreen('home');
  },

  showCreateRoom() { showScreen('create'); },
  showJoinRoom()   { showScreen('join'); },

  /* ─── Create Room ──────────────────────────────────── */
  async createRoom() {
    const name = document.getElementById('host-name-input').value.trim();
    if (!name) { notify('Enter your name!', 'error'); return; }
    if (name.length > 20) { notify('Name too long!', 'error'); return; }

    const code = genCode(4);
    State.roomCode  = code;
    State.isHost    = true;
    State.playerName = name;
    State.playerId   = 'host_' + Date.now();

    const roomData = {
      code,
      host: State.playerId,
      phase: PHASE.LOBBY,
      round: 1,
      attempt: 1,
      settings: { manualImpostor: false, timerDuration: 300 },
      score: { players: 0, impostor: 0 },
      roundHistory: [],
      players: {
        [State.playerId]: {
          id: State.playerId,
          name,
          avatar: avatarFor(name),
          isHost: true,
          joinedAt: Date.now(),
        }
      }
    };

    try {
      await dbSet(code, roomData);
      App._listenRoom(code);
      showScreen('lobby');
      notify('🏠 Room created! Code: ' + code, 'success');
    } catch (e) {
      notify('Error creating room: ' + e.message, 'error');
    }
  },

  /* ─── Join Room ────────────────────────────────────── */
  async joinRoom() {
    const name = document.getElementById('join-name-input').value.trim();
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();

    if (!name) { notify('Enter your name!', 'error'); return; }
    if (!code || code.length < 3) { notify('Enter a valid room code!', 'error'); return; }

    // Verify room exists
    const room = await dbGet(code);
    if (!room) { notify('Room not found! Check the code.', 'error'); return; }
    if (room.phase !== PHASE.LOBBY) { notify('Game already started!', 'warning'); return; }

    // Check name conflict
    const existing = Object.values(room.players || {}).find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) { notify('That name is taken! Choose another.', 'error'); return; }

    State.roomCode   = code;
    State.isHost     = false;
    State.playerName = name;
    State.playerId   = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);

    const playerData = {
      id: State.playerId,
      name,
      avatar: avatarFor(name),
      isHost: false,
      joinedAt: Date.now(),
    };

    try {
      await dbSet(`${code}/players/${State.playerId}`, playerData);
      App._listenRoom(code);
      showScreen('lobby');
      notify('🎮 Joined room ' + code + '!', 'success');
    } catch (e) {
      notify('Error joining room: ' + e.message, 'error');
    }
  },

  /* ─── Room Listener ────────────────────────────────── */
  _listenRoom(code) {
    if (State.listenerOff) State.listenerOff();
    State.listenerOff = dbOnValue(code, (data) => {
      if (!data) { App.goHome(); notify('Room closed.', 'warning'); return; }
      State.roomData = data;
      App._syncUI(data);
    });
  },

  /* ─── Master UI Sync ───────────────────────────────── */
  _syncUI(data) {
    if (!data) return;
    switch (data.phase) {
      case PHASE.LOBBY:      App._renderLobby(data);      break;
      case PHASE.DISCUSSION: App._renderGame(data);       break;
      case PHASE.VOTING:     App._renderVoting(data);     break;
      case PHASE.RESULTS:    App._renderResults(data);    break;
    }
  },

  /* ─── Render: Lobby ────────────────────────────────── */
  _renderLobby(data) {
    showScreen('lobby');
    State.wordRevealed = false;

    const players = Object.values(data.players || {});
    document.getElementById('lobby-room-code').textContent = data.code;
    document.getElementById('player-count').textContent   = players.length;
    document.getElementById('lobby-status-text').textContent =
      `${players.length} player${players.length !== 1 ? 's' : ''} in the lobby`;

    // Players grid
    const grid = document.getElementById('lobby-players-grid');
    grid.className = 'players-grid' + (State.isHost ? ' is-host-view' : '');
    grid.innerHTML = '';
    players.sort((a,b) => a.joinedAt - b.joinedAt).forEach(p => {
      const isYou  = p.id === State.playerId;
      const isHost = p.isHost;
      const chip = document.createElement('div');
      chip.className = `player-chip ${isHost ? 'is-host' : ''} ${isYou ? 'is-you' : ''}`;
      chip.innerHTML = `
        <span class="player-avatar">${p.avatar}</span>
        <div class="player-name">${p.name}</div>
        ${isHost ? `<span class="player-tag tag-host">HOST</span>` : ''}
        ${isYou  ? `<span class="player-tag tag-you">YOU</span>`  : ''}
        ${State.isHost && !isYou ? `<button class="remove-player-btn" onclick="App.removePlayer('${p.id}')" title="Remove player">✕</button>` : ''}
      `;
      grid.appendChild(chip);
    });

    // Host vs Player panels
    document.getElementById('host-settings-panel').style.display  = State.isHost ? 'block'  : 'none';
    document.getElementById('player-waiting-panel').style.display = State.isHost ? 'none'   : 'block';

    if (State.isHost) {
      // Sync settings
      const s = data.settings || {};
      document.getElementById('manual-impostor-toggle').checked = !!s.manualImpostor;
      document.getElementById('timer-duration-select').value = s.timerDuration || 300;
      document.getElementById('manual-impostor-panel').style.display = s.manualImpostor ? 'block' : 'none';

      // Impostor selector grid
      if (s.manualImpostor) {
        const iGrid = document.getElementById('impostor-select-grid');
        iGrid.innerHTML = '';
        players.filter(p => !p.isHost).forEach(p => {
          const card = document.createElement('div');
          card.className = 'impostor-select-card' + (data.manualImpostorId === p.id ? ' selected' : '');
          card.innerHTML = `<div style="font-size:1.8rem;margin-bottom:4px;">${p.avatar}</div><div>${p.name}</div>`;
          card.onclick = () => App.selectManualImpostor(p.id);
          iGrid.appendChild(card);
        });
      }

      // Disable start if too few players
      document.getElementById('start-game-btn').disabled = players.length < 2;
    }
  },

  /* ─── Lobby Actions ────────────────────────────────── */
  copyRoomCode() {
    navigator.clipboard.writeText(State.roomData?.code || State.roomCode)
      .then(() => notify('📋 Room code copied!', 'success'))
      .catch(() => notify(State.roomCode, 'info'));
  },

  async removePlayer(pid) {
    await dbRemove(`${State.roomCode}/players/${pid}`);
    notify('Player removed.', 'warning');
  },

  toggleImpostorMode() {
    const manual = document.getElementById('manual-impostor-toggle').checked;
    dbUpdate(`${State.roomCode}/settings`, { manualImpostor: manual });
  },

  updateTimerDuration() {
    const dur = parseInt(document.getElementById('timer-duration-select').value);
    dbUpdate(`${State.roomCode}/settings`, { timerDuration: dur });
  },

  async selectManualImpostor(pid) {
    await dbUpdate(State.roomCode, { manualImpostorId: pid });
    notify('Impostor selected!', 'success');
  },

  /* ─── Start Game ───────────────────────────────────── */
  async startGame() {
    const data = State.roomData;
    if (!data) return;
    const players = Object.values(data.players || {});
    if (players.length < 2) { notify('Need at least 2 players!', 'error'); return; }

    const round = data.round || 1;
    const roundKey = round === 1 ? 'round1' : round === 2 ? 'round2' : 'round3';
    const roundMeta = WORD_PAIRS[roundKey];

    // Pick random word pair
    const pairIdx = Math.floor(Math.random() * roundMeta.pairs.length);
    const pair = roundMeta.pairs[pairIdx];

    // Select impostor
    let impostorId;
    const settings = data.settings || {};
    if (settings.manualImpostor && data.manualImpostorId) {
      impostorId = data.manualImpostorId;
    } else {
      // Random impostor
      const shuffled = [...players].sort(() => Math.random() - 0.5);
      impostorId = shuffled[0].id;
    }

    // Assign words to players
    const assignments = {};
    players.forEach(p => {
      assignments[p.id] = {
        word: p.id === impostorId ? pair.impostor : pair.common,
        isImpostor: p.id === impostorId,
      };
    });

    await dbUpdate(State.roomCode, {
      phase: PHASE.DISCUSSION,
      impostorId,
      wordPair: pair,
      roundKey,
      assignments,
      attempt: 1,
      votes: null,
      timerStart: Date.now(),
      timerDuration: settings.timerDuration || 300,
      timerPaused: false,
      timerPausedAt: null,
    });

    notify('🚀 Game started!', 'success');
  },

  /* ─── Render: Game (Discussion) ────────────────────── */
  _renderGame(data) {
    const currentScreen = document.querySelector('.screen.active');
    if (!currentScreen || currentScreen.id !== 'screen-game') {
      showScreen('game');
      State.wordRevealed = false;
    }

    const players = Object.values(data.players || {});

    // Round badge
    const roundKey = data.roundKey || 'round1';
    const roundMeta = WORD_PAIRS[roundKey];
    const roundNum = roundKey === 'round1' ? 1 : roundKey === 'round2' ? 2 : 3;
    document.getElementById('round-badge-container').innerHTML = `
      <div class="round-badge r${roundNum}">${roundMeta.emoji} Round ${roundNum} – ${roundMeta.name}</div>
    `;

    // Attempt dots
    App._renderAttemptDots(data.attempt || 1, 'dot-');

    // Stage badge
    document.getElementById('game-stage-badge').innerHTML = `
      <span class="stage-badge discussion">🗣 Discussion</span>`;

    // Timer
    App._syncTimer(data);

    // Word card (only if not yet revealed in this session)
    const myAssign = data.assignments?.[State.playerId];
    if (myAssign && !State.wordRevealed) {
      // Keep card in locked state; reveal on tap
    }
    if (myAssign) {
      document.getElementById('secret-word-display').textContent = myAssign.word;
      document.getElementById('impostor-notice').style.display = myAssign.isImpostor ? 'flex' : 'none';
    }

    // Players list
    const pList = document.getElementById('game-players-list');
    pList.innerHTML = '';
    players.sort((a,b) => a.joinedAt - b.joinedAt).forEach(p => {
      const chip = document.createElement('div');
      chip.className = 'game-player-chip';
      const isYou = p.id === State.playerId;
      chip.innerHTML = `<span style="font-size:1.6rem;">${p.avatar}</span>
        <span>${p.name}${isYou ? ' <span style="color:var(--accent-purple);font-size:0.75rem;">(you)</span>' : ''}</span>`;
      pList.appendChild(chip);
    });

    // Host controls
    document.getElementById('host-game-controls').style.display   = State.isHost ? 'block' : 'none';
    document.getElementById('host-timer-controls').style.display  = State.isHost ? 'flex'  : 'none';
    document.getElementById('player-game-banner').style.display   = State.isHost ? 'none'  : 'block';
    document.getElementById('player-game-status-text').textContent = 'Discuss your clues with the group!';
  },

  /* ─── Timer Sync ────────────────────────────────────── */
  _syncTimer(data) {
    App._stopTimer();
    const duration   = data.timerDuration || 300;
    const start      = data.timerStart    || Date.now();
    const paused     = data.timerPaused   || false;
    const pausedAt   = data.timerPausedAt || null;
    const circumference = 2 * Math.PI * 78; // r=78

    const circle   = document.getElementById('timer-circle');
    const display  = document.getElementById('timer-display');
    const warning  = document.getElementById('timer-warning');

    circle.style.strokeDasharray  = circumference;
    circle.style.strokeDashoffset = 0;

    function update() {
      let elapsed;
      if (paused && pausedAt) {
        elapsed = (pausedAt - start) / 1000;
      } else {
        elapsed = (Date.now() - start) / 1000;
      }
      const remaining = Math.max(0, duration - elapsed);
      const pct       = remaining / duration;

      // Display
      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60);
      display.textContent = `${mins}:${secs.toString().padStart(2,'0')}`;

      // Ring
      circle.style.strokeDashoffset = circumference * (1 - pct);

      // Colors & warnings
      circle.classList.remove('warning','danger');
      display.classList.remove('warning','danger');
      warning.innerHTML = '';

      if (remaining <= 10 && remaining > 0) {
        circle.classList.add('danger');
        display.classList.add('danger');
        warning.innerHTML = `<span class="timer-warning-msg" style="color:#ef4444;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3)">🚨 FINAL 10 SECONDS!</span>`;
      } else if (remaining <= 60 && remaining > 0) {
        circle.classList.add('warning');
        display.classList.add('warning');
        warning.innerHTML = `<span class="timer-warning-msg" style="color:#f59e0b;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3)">⚠️ Final minute!</span>`;
      }

      if (remaining <= 0) {
        App._stopTimer();
        display.textContent = '0:00';
        warning.innerHTML = `<span class="timer-warning-msg" style="color:#ef4444;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3)">⏰ TIME'S UP!</span>`;
      }
    }

    update();
    if (!paused) {
      State.timerInterval = setInterval(update, 500);
    }
  },

  _stopTimer() {
    if (State.timerInterval) { clearInterval(State.timerInterval); State.timerInterval = null; }
  },

  async pauseTimer() {
    const data = State.roomData;
    if (!data) return;
    const now = Date.now();
    if (data.timerPaused) {
      // Resume: shift timerStart forward
      const pausedDuration = now - data.timerPausedAt;
      await dbUpdate(State.roomCode, {
        timerPaused: false,
        timerPausedAt: null,
        timerStart: data.timerStart + pausedDuration,
      });
      document.getElementById('btn-pause-timer').textContent = '⏸ Pause';
      notify('Timer resumed', 'info');
    } else {
      await dbUpdate(State.roomCode, { timerPaused: true, timerPausedAt: now });
      document.getElementById('btn-pause-timer').textContent = '▶ Resume';
      notify('Timer paused', 'warning');
    }
  },

  async resetTimer() {
    await dbUpdate(State.roomCode, {
      timerStart: Date.now(),
      timerPaused: false,
      timerPausedAt: null,
    });
    notify('Timer reset', 'info');
  },

  /* ─── Word Reveal ───────────────────────────────────── */
  revealWord() {
    if (State.wordRevealed) return;
    State.wordRevealed = true;
    const card = document.getElementById('word-card');
    card.classList.add('revealed');
    card.querySelector('.word-revealed-state').style.display = 'block';
  },

  /* ─── Attempt Dots ──────────────────────────────────── */
  _renderAttemptDots(attempt, prefix) {
    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(`${prefix}${i}`);
      if (!dot) continue;
      dot.classList.remove('used','current');
      if (i < attempt)      dot.classList.add('used');
      else if (i === attempt) dot.classList.add('current');
    }
  },

  /* ─── Open Voting ───────────────────────────────────── */
  async openVoting() {
    await dbUpdate(State.roomCode, { phase: PHASE.VOTING, votes: {} });
    notify('🗳️ Voting opened!', 'success');
  },

  /* ─── Render: Voting ────────────────────────────────── */
  _renderVoting(data) {
    App._stopTimer();
    showScreen('voting');

    const players = Object.values(data.players || {});
    const votes   = data.votes   || {};
    const attempt = data.attempt || 1;

    // Attempt dots
    App._renderAttemptDots(attempt, 'vote-dot-');

    // My vote status
    const myVote = votes[State.playerId];
    const myStatus = document.getElementById('voting-my-status');
    if (myVote) {
      myStatus.innerHTML = `<div class="status-dot" style="background:#10b981;"></div><span>Vote cast ✓</span>`;
      State.hasVoted = true;
      State.myVoteTarget = myVote;
    } else {
      myStatus.innerHTML = `<div class="status-dot" style="background:#f59e0b;"></div><span>Choosing...</span>`;
    }

    // Vote tally
    const tally = {}; // pid -> count
    players.forEach(p => { tally[p.id] = 0; });
    Object.values(votes).forEach(targetId => { if (tally[targetId] !== undefined) tally[targetId]++; });

    const totalVotes = Object.keys(votes).length;
    const totalPlayers = players.length;

    // Vote tally preview
    document.getElementById('vote-tally-preview').style.display  = totalVotes > 0 ? 'block' : 'none';
    document.getElementById('votes-in-count').textContent = totalVotes;
    document.getElementById('votes-total').textContent    = totalPlayers;

    // Build vote grid
    const grid = document.getElementById('vote-grid');
    grid.innerHTML = '';
    const isSelf = (pid) => pid === State.playerId;

    players.sort((a,b) => a.joinedAt - b.joinedAt).forEach(p => {
      const card = document.createElement('div');
      const isSelected = State.selectedVote === p.id;
      const hasVotedForThis = myVote === p.id;
      card.className = `vote-card ${isSelf(p.id) ? 'is-self' : ''} ${isSelected ? 'selected' : ''} ${hasVotedForThis ? 'voted-for' : ''}`;
      card.id = `vote-card-${p.id}`;

      const pct = totalPlayers > 0 ? (tally[p.id] / totalPlayers) * 100 : 0;

      card.innerHTML = `
        <div style="font-size:2.4rem;margin-bottom:6px;">${p.avatar}</div>
        <div style="font-weight:800;font-size:0.95rem;">${p.name}</div>
        ${isSelf(p.id) ? '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">(you)</div>' : ''}
        <div class="vote-bar-container">
          <div class="vote-bar" style="width:${pct}%"></div>
        </div>
        <div class="vote-count">${tally[p.id]} vote${tally[p.id] !== 1 ? 's': ''}</div>
      `;

      if (!isSelf(p.id) && !myVote) {
        card.onclick = () => App.selectVote(p.id);
      }

      grid.appendChild(card);
    });

    const submitBtn = document.getElementById('btn-submit-vote');
    submitBtn.disabled = !State.selectedVote || State.hasVoted;
    if (State.hasVoted) {
      document.getElementById('vote-instruction').textContent = '✅ Your vote is in! Waiting for others...';
      submitBtn.textContent = '✅ Vote Submitted';
    } else {
      document.getElementById('vote-instruction').textContent = 'Tap a player you suspect is the impostor:';
      submitBtn.textContent = '✅ Submit Vote';
    }

    // Host controls
    document.getElementById('host-voting-controls').style.display = State.isHost ? 'block' : 'none';
  },

  selectVote(pid) {
    if (State.hasVoted) return;
    State.selectedVote = pid;
    // Re-render vote cards
    document.querySelectorAll('.vote-card').forEach(card => card.classList.remove('selected'));
    const target = document.getElementById(`vote-card-${pid}`);
    if (target) target.classList.add('selected');
    document.getElementById('btn-submit-vote').disabled = false;
  },

  async submitVote() {
    if (!State.selectedVote || State.hasVoted) return;
    await dbUpdate(`${State.roomCode}/votes`, { [State.playerId]: State.selectedVote });
    State.hasVoted = true;
    notify('✅ Vote submitted!', 'success');
  },

  /* ─── Reveal Results ──────────────────────────────────*/
  async revealResults() {
    const data = State.roomData;
    if (!data) return;

    const votes      = data.votes || {};
    const players    = Object.values(data.players || {});
    const impostorId = data.impostorId;

    // Tally
    const tally = {};
    players.forEach(p => { tally[p.id] = 0; });
    Object.values(votes).forEach(tid => { if (tally[tid] !== undefined) tally[tid]++; });

    // Find most voted
    let maxVotes = 0;
    let mostVotedId = null;
    for (const [pid, cnt] of Object.entries(tally)) {
      if (cnt > maxVotes) { maxVotes = cnt; mostVotedId = pid; }
    }

    const caughtImpostor = mostVotedId === impostorId;

    // Update score
    const score    = { ...(data.score || { players: 0, impostor: 0 }) };
    const attempt  = data.attempt || 1;
    if (caughtImpostor) score.players++;
    // Impostor gets a point only after 3 failed attempts (handled in nextAttempt)

    // Round history
    const history = [...(data.roundHistory || []), {
      round: data.round,
      attempt,
      caughtImpostor,
      impostorId,
      votes: tally,
      pair: data.wordPair,
    }];

    await dbUpdate(State.roomCode, {
      phase: PHASE.RESULTS,
      score,
      roundHistory: history,
      resultCaughtImpostor: caughtImpostor,
    });
  },

  /* ─── Next Attempt ──────────────────────────────────── */
  async nextAttempt() {
    const data    = State.roomData;
    if (!data) return;
    const attempt = (data.attempt || 1) + 1;

    if (attempt > 3) {
      // Impostor wins
      const score = { ...(data.score || { players: 0, impostor: 0 }) };
      score.impostor++;
      const history = [...(data.roundHistory || []), {
        round: data.round, attempt: 3,
        caughtImpostor: false,
        impostorId: data.impostorId,
        votes: {},
        pair: data.wordPair,
      }];
      await dbUpdate(State.roomCode, {
        phase: PHASE.RESULTS,
        score,
        roundHistory: history,
        resultCaughtImpostor: false,
        attempt: 3,
      });
      return;
    }

    // Reset for next attempt (same round)
    await dbUpdate(State.roomCode, {
      phase: PHASE.DISCUSSION,
      attempt,
      votes: {},
      timerStart: Date.now(),
      timerPaused: false,
      timerPausedAt: null,
    });

    State.hasVoted     = false;
    State.selectedVote = null;
    State.myVoteTarget = null;
    notify(`⚠️ Attempt ${attempt} begins!`, 'warning');
  },

  /* ─── Render: Results ───────────────────────────────── */
  _renderResults(data) {
    App._stopTimer();
    showScreen('results');

    const caught     = data.resultCaughtImpostor;
    const impostorId = data.impostorId;
    const players    = Object.values(data.players || {});
    const votes      = data.votes || {};
    const pair       = data.wordPair || { common: '?', impostor: '?' };
    const score      = data.score    || { players: 0, impostor: 0 };
    const attempt    = data.attempt  || 1;

    // Result banner
    const banner = document.getElementById('result-banner');
    banner.className = 'result-banner ' + (caught ? 'win' : 'lose');
    document.getElementById('result-emoji').textContent   = caught ? '🎉' : '😈';
    document.getElementById('result-title').textContent   = caught ? '🕵️ Impostor Caught!' : '😈 Impostor Wins!';
    document.getElementById('result-subtitle').textContent =
      caught
        ? `The group identified the impostor on attempt ${attempt}!`
        : 'The impostor fooled everyone after 3 failed attempts!';

    if (caught) App._launchConfetti();

    // Score
    document.getElementById('score-players').textContent  = score.players  || 0;
    document.getElementById('score-impostor').textContent = score.impostor || 0;

    // Score progress (round history markers)
    const history = data.roundHistory || [];
    const progressRow = document.getElementById('score-progress-row');
    progressRow.innerHTML = '';
    history.slice(-15).forEach((h, i) => {
      const el = document.createElement('div');
      el.className = `score-progress-item ${h.caughtImpostor ? 'win' : 'lose'}`;
      el.textContent = `R${h.round} ${h.caughtImpostor ? '✓' : '✗'}`;
      el.title = `Round ${h.round}: ${h.caughtImpostor ? 'Players won' : 'Impostor won'}`;
      progressRow.appendChild(el);
    });

    // Impostor reveal
    const impostor = players.find(p => p.id === impostorId);
    document.getElementById('impostor-reveal-name').textContent =
      impostor ? `${impostor.avatar} ${impostor.name}` : '???';

    // Words reveal
    document.getElementById('words-reveal').innerHTML = `
      <div class="word-reveal-pill common">
        <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;opacity:0.7;">Everyone's Word</div>
        <div style="font-size:1.4rem;font-weight:900;">${pair.common}</div>
      </div>
      <div style="font-size:1.5rem;display:flex;align-items:center;">vs</div>
      <div class="word-reveal-pill impostor-word">
        <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;opacity:0.7;">Impostor's Word</div>
        <div style="font-size:1.4rem;font-weight:900;">${pair.impostor}</div>
      </div>
    `;

    // Tally
    const tally = {};
    players.forEach(p => { tally[p.id] = 0; });
    Object.values(votes).forEach(tid => { if (tally[tid] !== undefined) tally[tid]++; });

    const maxVotes = Math.max(...Object.values(tally), 1);
    const list = document.getElementById('vote-results-list');
    list.innerHTML = '';
    players.sort((a,b) => (tally[b.id] || 0) - (tally[a.id] || 0)).forEach(p => {
      const isImpostor = p.id === impostorId;
      const cnt = tally[p.id] || 0;
      const pct = (cnt / maxVotes) * 100;
      const row = document.createElement('div');
      row.className = `vote-result-row ${isImpostor ? 'impostor-row' : ''}`;
      row.innerHTML = `
        <div class="vote-result-avatar">${p.avatar}</div>
        <div class="vote-result-name">
          ${p.name}
          ${isImpostor ? '<span class="spy-badge">🕵️ IMPOSTOR</span>' : ''}
          ${p.id === State.playerId ? '<span style="font-size:0.7rem;color:var(--text-muted);"> (you)</span>' : ''}
        </div>
        <div class="vote-result-bar-wrap">
          <div class="vote-result-bar ${isImpostor ? 'impostor-bar' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="vote-count-badge">${cnt} vote${cnt !== 1 ? 's' : ''}</div>
      `;
      list.appendChild(row);
    });

    // Host/Player result controls
    document.getElementById('results-host-controls').style.display   = State.isHost ? 'block' : 'none';
    document.getElementById('results-player-wait').style.display     = State.isHost ? 'none'  : 'block';
  },

  /* ─── Next Round ────────────────────────────────────── */
  async nextRound() {
    const data    = State.roomData;
    if (!data) return;
    const nextRound = Math.min((data.round || 1) + 1, 3);
    await dbUpdate(State.roomCode, {
      phase: PHASE.LOBBY,
      round: nextRound,
      attempt: 1,
      votes: {},
      assignments: null,
      impostorId: null,
      wordPair: null,
      roundKey: null,
      resultCaughtImpostor: null,
      manualImpostorId: null,
      timerPaused: false,
      timerPausedAt: null,
    });
    State.hasVoted = false;
    State.selectedVote = null;
    State.myVoteTarget = null;
    State.wordRevealed = false;
    notify(`▶ Round ${nextRound} lobby opened!`, 'success');
  },

  async playAgain() {
    const data = State.roomData;
    if (!data) return;
    await dbUpdate(State.roomCode, {
      phase: PHASE.LOBBY,
      attempt: 1,
      votes: {},
      assignments: null,
      impostorId: null,
      wordPair: null,
      roundKey: null,
      resultCaughtImpostor: null,
      manualImpostorId: null,
      timerPaused: false,
      timerPausedAt: null,
    });
    State.hasVoted = false;
    State.selectedVote = null;
    State.myVoteTarget = null;
    State.wordRevealed = false;
    notify('🔄 Same round, new game!', 'success');
  },

  /* ─── Skip Round ────────────────────────────────────── */
  async skipRound() {
    if (!confirm('Skip this round?')) return;
    const score = { ...(State.roomData?.score || { players: 0, impostor: 0 }) };
    score.impostor++;
    await dbUpdate(State.roomCode, {
      phase: PHASE.RESULTS,
      score,
      resultCaughtImpostor: false,
      roundHistory: [...(State.roomData?.roundHistory || []), {
        round: State.roomData?.round, attempt: State.roomData?.attempt,
        caughtImpostor: false, skipped: true,
        impostorId: State.roomData?.impostorId,
        votes: {}, pair: State.roomData?.wordPair,
      }]
    });
    notify('⏭ Round skipped.', 'warning');
  },

  /* ─── Reset Round ───────────────────────────────────── */
  async resetRound() {
    if (!confirm('Reset this round?')) return;
    await dbUpdate(State.roomCode, {
      phase: PHASE.LOBBY,
      attempt: 1,
      votes: {},
      assignments: null,
      impostorId: null,
      wordPair: null,
      roundKey: null,
      resultCaughtImpostor: null,
      manualImpostorId: null,
      timerPaused: false,
      timerPausedAt: null,
    });
    State.hasVoted = false;
    State.selectedVote = null;
    State.wordRevealed = false;
    notify('🔄 Round reset!', 'warning');
  },

  /* ─── Full Game Reset ───────────────────────────────── */
  async resetGame() {
    if (!confirm('Reset the entire game? Scores will be cleared.')) return;
    App._stopTimer();

    const players = State.roomData?.players || {};
    await dbSet(State.roomCode, {
      code: State.roomCode,
      host: State.playerId,
      phase: PHASE.LOBBY,
      round: 1,
      attempt: 1,
      settings: { manualImpostor: false, timerDuration: 300 },
      score: { players: 0, impostor: 0 },
      roundHistory: [],
      players,
    });

    State.hasVoted = false;
    State.selectedVote = null;
    State.wordRevealed = false;
    notify('🔄 Game reset!', 'warning');
  },

  /* ─── Confetti ──────────────────────────────────────── */
  _launchConfetti() {
    const container = document.getElementById('confetti-container');
    const colors = ['#a855f7','#06b6d4','#ec4899','#f59e0b','#10b981','#ef4444','#ffffff'];
    for (let i = 0; i < 120; i++) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        const size = 6 + Math.random() * 10;
        el.style.cssText = `
          left:${Math.random() * 100}%;
          width:${size}px; height:${size}px;
          background:${colors[Math.floor(Math.random() * colors.length)]};
          animation-duration:${1.5 + Math.random() * 2.5}s;
          animation-delay:${Math.random() * 0.5}s;
          border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
        `;
        container.appendChild(el);
        setTimeout(() => el.remove(), 4000);
      }, Math.random() * 800);
    }
  },

};

/* ─── CSS Grid responsive fix for game screen ─────────── */
function handleGameGridResize() {
  const grid = document.querySelector('.game-top-grid');
  if (!grid) return;
  if (window.innerWidth < 640) {
    grid.style.gridTemplateColumns = '1fr';
  } else {
    grid.style.gridTemplateColumns = '1fr 1fr';
  }
}

/* ─── Keyboard shortcuts ─────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const activeScreen = document.querySelector('.screen.active');
    if (!activeScreen) return;
    if (activeScreen.id === 'screen-create') App.createRoom();
    if (activeScreen.id === 'screen-join')   App.joinRoom();
  }
});

/* ─── Room code input: auto-uppercase ─────────────────── */
document.getElementById('room-code-input').addEventListener('input', function() {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

/* ─── Boot ──────────────────────────────────────────────*/
(function boot() {
  // Shapes
  initFloatingShapes();

  // Responsive game grid
  window.addEventListener('resize', handleGameGridResize);
  handleGameGridResize();

  // Priority 1: config.js injected from environment variables
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey && !window.FIREBASE_CONFIG.apiKey.startsWith('YOUR_')) {
    try {
      const cfg = window.FIREBASE_CONFIG;
      if (!firebase.apps.length) {
        firebase.initializeApp({
          apiKey:            cfg.apiKey,
          authDomain:        cfg.authDomain        || `${cfg.projectId}.firebaseapp.com`,
          projectId:         cfg.projectId,
          storageBucket:     cfg.storageBucket     || `${cfg.projectId}.appspot.com`,
          messagingSenderId: cfg.messagingSenderId || '',
          appId:             cfg.appId,
          measurementId:     cfg.measurementId     || '',
          databaseURL:       cfg.databaseURL,
        });
      }
      State.db = firebase.database();
      notify('🔥 Firebase connected!', 'success');
      return; // done – skip modal entirely
    } catch (e) {
      console.warn('FIREBASE_CONFIG init failed:', e.message);
    }
  }

  // Priority 2: restore from localStorage (previous manual entry)
  const saved = localStorage.getItem('ws_fb_config');
  if (saved) {
    try {
      const { apiKey, projectId, dbUrl } = JSON.parse(saved);
      document.getElementById('fb-api-key').value    = apiKey;
      document.getElementById('fb-project-id').value = projectId;
      document.getElementById('fb-db-url').value     = dbUrl;
      if (!firebase.apps.length) {
        firebase.initializeApp({ apiKey, projectId, databaseURL: dbUrl, authDomain: `${projectId}.firebaseapp.com` });
      }
      State.db = firebase.database();
      // Silent success – no modal needed
    } catch (e) {
      modal('firebase', true);
    }
  } else {
    // Priority 3: show manual setup modal
    modal('firebase', true);
  }
})();
