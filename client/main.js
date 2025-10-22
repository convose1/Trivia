// Temporary: confirm client script is actually loading in the browser
try { console.log('[UI] main.js initialized'); } catch {}

// Support embedding: receive player name/avatar and optional start command from parent
try {
  window.addEventListener('message', (e) => {
    const origin = e.origin || '';
    const allowed = [
      'http://localhost:',
      'http://127.0.0.1:',
      'https://convose.com',
    ];
    if (!allowed.some(p => origin.startsWith(p))) return;
    const data = e.data || {};
    if (data && data.type === 'SET_PLAYER_NAME') {
      const payload = data.payload || {};
      const name = String(payload.name || '').trim();
      const avatar = String(payload.avatar || '').trim();
      if (name) {
        myName = name;
        myAvatar = avatar;
        socket.emit('join', { name, avatar });
        hasJoined = true;
        hide(welcomeScreen);
        show(lobbyScreen);
        currentPhase = 'lobby';
        inRound = false;
      }
    }
    if (data && data.type === 'START_GAME') {
      socket.emit('startGame');
    }
  });
} catch {}

/* Multiplayer TechQuiz client */
// Allow overriding the socket server via query string: ?server=https://your-server.example.com
const qs = new URLSearchParams(location.search);
const serverOverride = qs.get('server');
const socket = serverOverride ? io(serverOverride) : io();
try { console.log('[SOCKET] attempting connection...'); } catch {}

// --- DOM elements ---
const welcomeScreen = document.getElementById('welcomeScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const quizScreen = document.getElementById('quizScreen');
const resultsScreen = document.getElementById('resultsScreen');
const nameForm = document.getElementById('nameForm');
const playerNameDisplay = document.getElementById('playerName');
const currentScoreDisplay = document.getElementById('currentScore');
const currentQuestionDisplay = document.getElementById('currentQuestion');
const totalQuestionsDisplay = document.getElementById('totalQuestions');
const progressPercentDisplay = document.getElementById('progressPercent');
const progressBar = document.getElementById('progressBar');
const questionText = document.getElementById('questionText');
const optionsContainer = document.getElementById('optionsContainer');
const timerText = document.getElementById('timerText');
const timerCircle = document.getElementById('timerCircle');
const statusHint = document.getElementById('statusHint');

const leaderboardStrip = document.getElementById('leaderboardStrip');
const leaderboardList = document.getElementById('leaderboardList');

const finalPlayerName = document.getElementById('finalPlayerName');
const finalScore = document.getElementById('finalScore');
const resultIcon = document.getElementById('resultIcon');
const topicSelect = document.getElementById('topicSelect');
const startGameBtn = document.getElementById('startGameBtn');
const lobbyParticipants = document.getElementById('lobbyParticipants');
// Results screen elements
const resultTitle = document.getElementById('resultTitle');
const topicSelectResults = document.getElementById('topicSelectResults');
const newGameBtn = document.getElementById('newGameBtn');
const lobbyParticipantsResults = document.getElementById('lobbyParticipantsResults');

// --- Client state ---
let myName = '';
let myAvatar = '';
let myId = null;
let myScore = 0;
let answered = false;
let deadlineTs = 0;
let timerInterval = null;
let lastQuestionIdx = -1;
let totalQuestions = 10;
let hasJoined = false;
let currentPhase = 'lobby';
let inRound = false;
// Track latest lobby and leaderboard data for results screen
let lastTopic = 'Technology';
let lastTopics = [];
let lastParticipants = [];

// --- Utilities ---
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function setTimerFromDeadline(deadline) {
  clearInterval(timerInterval);
  deadlineTs = deadline || 0;
  tickTimer();
  if (!deadlineTs) return;
  timerInterval = setInterval(tickTimer, 250);
}
function tickTimer() {
  if (!deadlineTs) return;
  const now = Date.now();
  let msLeft = Math.max(0, deadlineTs - now);
  const secondsLeft = Math.ceil(msLeft / 1000);
  timerText.textContent = String(secondsLeft);

  const total = 10; // server uses 10 sec questions
  const circumference = 2 * Math.PI * 45;
  const frac = Math.min(1, Math.max(0, msLeft / (total * 1000)));
  const offset = circumference - frac * circumference;
  timerCircle.style.strokeDashoffset = offset;

  if (secondsLeft <= 3) {
    timerCircle.setAttribute('stroke', '#ef4444');
    timerText.classList.add('danger');
  } else if (secondsLeft <= 5) {
    timerCircle.setAttribute('stroke', '#f59e0b');
    timerText.classList.add('warning');
    timerText.classList.remove('danger');
  } else {
    timerCircle.setAttribute('stroke', '#6366f1');
    timerText.classList.remove('warning', 'danger');
  }
}

function renderLeaderboard(list) {
  leaderboardList.innerHTML = '';
  // remember as participants snapshot (id, name, avatar)
  lastParticipants = list.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score }));
  list.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = 'flex items-center gap-2 shrink-0';
    item.innerHTML = `
      <div class="text-xs text-slate-400 w-5 text-center">${idx + 1}</div>
      <img class="avatar border border-slate-600" src="${p.avatar}" alt="${p.name}" />
      <div class="flex flex-col leading-tight">
        <div class="text-xs font-medium text-slate-100">${p.name}</div>
        <div class="text-[11px] text-indigo-400 font-semibold">${p.score} pts</div>
      </div>
    `;
    leaderboardList.appendChild(item);
    if (p.id === myId) {
      myScore = p.score;
      currentScoreDisplay.textContent = String(myScore);
    }
  });
  show(leaderboardStrip);
}

function renderLobby({ topics, topic, participants }) {
  // populate topics
  topicSelect.innerHTML = '';
  topics.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t; if (t === topic) opt.selected = true; topicSelect.appendChild(opt);
  });
  // participants
  lobbyParticipants.innerHTML = '';
  participants.forEach(p => {
    const img = document.createElement('img');
    img.src = p.avatar; img.alt = p.name; img.title = p.name; img.className = 'avatar border border-gray-200';
    lobbyParticipants.appendChild(img);
  });
  // reset Start Game button state (in case it was disabled on previous click)
  if (startGameBtn) {
    startGameBtn.disabled = false;
    startGameBtn.textContent = startGameBtn.dataset.originalText || 'Start Game';
    startGameBtn.classList.remove('opacity-75', 'cursor-not-allowed');
  }
}

function setProgress(index, total) {
  lastQuestionIdx = index;
  totalQuestions = total;
  currentQuestionDisplay.textContent = String(index + 1);
  totalQuestionsDisplay.textContent = String(total);
  const progress = Math.round(((index + 1) / total) * 100);
  progressPercentDisplay.textContent = progress + '%';
  progressBar.style.width = progress + '%';
}

function renderQuestion(payload) {
  // payload: { index, total, question, options, deadlineTs }
  answered = false;
  playerNameDisplay.textContent = myName;
  currentScoreDisplay.textContent = String(myScore);

  questionText.textContent = payload.question;
  optionsContainer.innerHTML = '';
  payload.options.forEach((option, index) => {
    const optionCard = document.createElement('div');
    optionCard.className = 'option-card border-2 rounded-lg p-4 hover:border-indigo-500';
    optionCard.innerHTML = `
      <div class="flex items-center">
        <div class="flex-shrink-0 w-8 h-8 dark-option-label rounded-full flex items-center justify-center mr-3">
          <span class="text-sm font-semibold">${String.fromCharCode(65 + index)}</span>
        </div>
        <span class="text-slate-200">${option}</span>
      </div>
    `;
    optionCard.addEventListener('click', () => onSelect(index, optionCard));
    optionsContainer.appendChild(optionCard);
  });

  setProgress(payload.index, payload.total);
  setTimerFromDeadline(payload.deadlineTs);
  statusHint.textContent = '';
}

function onSelect(index, element) {
  if (answered) return;
  answered = true;
  // visual immediate selection
  document.querySelectorAll('.option-card').forEach(card => card.classList.remove('selected'));
  element.classList.add('selected');
  // send to server
  socket.emit('answer', { choice: index });
}

function renderReveal({ correctIndex, perPlayer }) {
  // mark correctness locally
  const cards = document.querySelectorAll('.option-card');
  if (cards[correctIndex]) cards[correctIndex].classList.add('correct');
  cards.forEach((c, idx) => {
    if (idx !== correctIndex && c.classList.contains('selected')) c.classList.add('incorrect');
    // disable interaction
    c.style.pointerEvents = 'none';
  });
  // Do not show intermission text
  statusHint.textContent = '';
  setTimerFromDeadline(0);
}

function renderCountdown({ deadlineTs }) {
  hide(resultsScreen);
  show(quizScreen);
  statusHint.textContent = 'Round starting...';
  questionText.textContent = 'Get ready!';
  optionsContainer.innerHTML = '';
  setTimerFromDeadline(deadlineTs);
}

function renderGameOver({ final }) {
  setTimerFromDeadline(0);
  hide(quizScreen);
  show(resultsScreen);
  // Winner title
  const winner = final && final.length ? final[0] : null;
  const winnerName = winner ? winner.name : 'Someone';
  if (resultTitle) resultTitle.textContent = `${winnerName} Won!`;
  // my final score (fallback to myScore)
  const mine = final.find(p => p.id === myId);
  finalScore.textContent = String(mine ? mine.score : myScore);
  // icon - trophy for winner, thumbs-up otherwise
  if (winner && winner.id === myId) {
    resultIcon.className = 'fas fa-trophy text-6xl text-yellow-500 mb-4';
  } else {
    resultIcon.className = 'fas fa-thumbs-up text-6xl text-blue-500 mb-4';
  }
  // also render topic/participants sections similar to lobby using last known data
  renderResultsMeta();
}

// --- Socket events ---
socket.on('connect', () => {
  myId = socket.id;
  try { console.log('[SOCKET] connected', { myId }); } catch {}
});

socket.on('leaderboard', (list) => {
  renderLeaderboard(list);
});

socket.on('phase', ({ phase }) => {
  currentPhase = phase;
  if (phase === 'finished') {
    // stay on results/lobby per later events
    inRound = false;
  }
});

socket.on('lobbyState', (payload) => {
  if (!hasJoined) return; // only show after joining
  // Update list and topics always
  renderLobby(payload);
  // remember for results screen
  lastTopic = payload.topic || lastTopic;
  lastTopics = Array.isArray(payload.topics) ? payload.topics : lastTopics;
  // convert participants shape to include id,name,avatar
  if (Array.isArray(payload.participants)) {
    lastParticipants = payload.participants.map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
  }
  // Only switch to lobby UI if server phase is lobby/finished
  if (payload.phase === 'lobby' || payload.phase === 'finished') {
    currentPhase = payload.phase;
    inRound = false;
    hide(welcomeScreen);
    hide(quizScreen);
    hide(resultsScreen);
    show(lobbyScreen);
  }
});

socket.on('countdown', (payload) => {
  console.log('[SOCKET] countdown received', { myId, payload });
  // Only participate if server indicates this client is in the participants list (if provided)
  const listed = Array.isArray(payload.participants) ? payload.participants.includes(myId) : true;
  if (!listed) {
    // ignore countdown, remain in lobby
    currentPhase = 'countdown';
    inRound = false;
    console.log('[SOCKET] countdown ignored; not listed in participants');
    return;
  }
  currentPhase = 'countdown';
  inRound = true;
  hide(welcomeScreen);
  hide(lobbyScreen);
  renderCountdown(payload);
});

socket.on('question', (payload) => {
  if (!inRound) return; // observers stay in lobby
  currentPhase = 'question';
  hide(welcomeScreen);
  hide(lobbyScreen);
  show(quizScreen);
  renderQuestion(payload);
});

socket.on('reveal', (payload) => {
  if (!inRound) return;
  currentPhase = 'reveal';
  renderReveal(payload);
});

socket.on('gameOver', (payload) => {
  // Always show results
  renderGameOver(payload);
  // After round, everyone returns to lobby view/state
  inRound = false;
  currentPhase = 'finished';
});

// --- UI events ---
nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('userName').value.trim();
  const avatar = document.getElementById('avatarUrl').value.trim();
  if (!name) return;
  myName = name;
  myAvatar = avatar;
  socket.emit('join', { name, avatar });
  hasJoined = true;
  hide(welcomeScreen);
  show(lobbyScreen);
  currentPhase = 'lobby';
  inRound = false;
});

topicSelect?.addEventListener('change', (e) => {
  const value = e.target.value;
  socket.emit('setTopic', { topic: value });
});

startGameBtn?.addEventListener('click', () => {
  console.log('[UI] Start Game clicked (listener). Emitting startGame');
  try {
    startGameBtn.disabled = true;
    const originalText = startGameBtn.textContent;
    startGameBtn.dataset.originalText = originalText || '';
    startGameBtn.textContent = 'Starting…';
    startGameBtn.classList.add('opacity-75', 'cursor-not-allowed');
  } catch {}
  try { console.log('[UI] emitting startGame via socket.emit'); } catch {}
  socket.emit('startGame');
});

// Fallback: delegated click handler in case direct listener wasn't attached
document.addEventListener('click', (e) => {
  try {
    const target = e.target && e.target.id ? `#${e.target.id}` : e.target && e.target.tagName;
    console.log('[UI] Global click detected on', target);
  } catch {}
  const btn = e.target && (e.target.closest ? e.target.closest('#startGameBtn') : null);
  if (!btn) return;
  console.log('[UI] Delegated Start Game click. Emitting startGame');
  try {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.dataset.originalText = originalText || '';
    btn.textContent = 'Starting…';
    btn.classList.add('opacity-75', 'cursor-not-allowed');
  } catch {}
  try { console.log('[UI] emitting startGame via socket.emit (delegated)'); } catch {}
  socket.emit('startGame');
});

// Expose a helper for manual triggering from console if needed
try {
  window.triggerStartGame = () => {
    try { console.log('[UI] window.triggerStartGame() called. Emitting startGame'); } catch {}
    socket.emit('startGame');
  };
} catch {}

// Results screen interactions
topicSelectResults?.addEventListener('change', (e) => {
  const value = e.target.value;
  socket.emit('setTopic', { topic: value });
});

newGameBtn?.addEventListener('click', () => {
  socket.emit('startGame');
});

// Helpers to populate results meta
function renderResultsMeta() {
  // topic select
  if (topicSelectResults) {
    topicSelectResults.innerHTML = '';
    (lastTopics || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      if (t === lastTopic) opt.selected = true;
      topicSelectResults.appendChild(opt);
    });
  }
  // participants
  if (lobbyParticipantsResults) {
    lobbyParticipantsResults.innerHTML = '';
    (lastParticipants || []).forEach(p => {
      const item = document.createElement('div');
      item.className = 'flex items-center gap-2';
      item.innerHTML = `
        <img class="avatar border border-gray-200" src="${p.avatar}" alt="${p.name}" />
        <div class="text-sm text-gray-800">${p.name}</div>
      `;
      lobbyParticipantsResults.appendChild(item);
    });
  }
}
