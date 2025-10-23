// Temporary: confirm client script is actually loading in the browser
try { console.log('[UI] main.js initialized'); } catch {}

// Celebration animation when local player wins
function startCelebration() {
  if (!celebrationLayer) return;
  celebrationLayer.innerHTML = '';
  celebrationLayer.classList.remove('hidden');
  // radial burst
  const burst = document.createElement('div');
  burst.className = 'celebrate-burst';
  celebrationLayer.appendChild(burst);

  const emojis = ['🎉','🎊','🥳','✨','💯','🔥','👏','🏆'];
  const count = 28;
  for (let i = 0; i < count; i++) {
    const e = document.createElement('div');
    e.className = 'celebrate-emoji';
    e.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const x = Math.random() * 100; // percent across
    const y = 70 + Math.random() * 20; // start near bottom
    const delay = (Math.random() * 0.6).toFixed(2);
    const rot = (Math.random() * 60 - 30).toFixed(0) + 'deg';
    e.style.left = x + '%';
    e.style.bottom = (100 - y) + 'px';
    e.style.animationDelay = delay + 's';
    e.style.setProperty('--rot', rot);
    celebrationLayer.appendChild(e);
  }
  // auto hide layer after animation
  setTimeout(() => {
    if (celebrationLayer) { celebrationLayer.classList.add('hidden'); celebrationLayer.innerHTML = ''; }
  }, 1800);
}

// Update the Start button text in the lobby to "Starting in N" during countdown
function updateStartButtonCountdown(deadlineTs) {
  if (!startGameBtn || !deadlineTs) return;
  try { clearInterval(startBtnInterval); } catch {}
  const tick = () => {
    const now = Date.now();
    const left = Math.max(0, Math.ceil((deadlineTs - now) / 1000));
    if (left > 0) {
      startGameBtn.textContent = `Starting in ${left}`;
      startGameBtn.disabled = true;
      startGameBtn.classList.add('opacity-75', 'cursor-not-allowed');
    } else {
      startGameBtn.textContent = 'Starting...';
      clearInterval(startBtnInterval);
    }
  };
  tick();
  startBtnInterval = setInterval(tick, 200);
}

// Render the participants row within the quiz card using latest scores
function renderQuizParticipants() {
  if (!quizParticipants) return;
  quizParticipants.innerHTML = '';
  (lastParticipants || []).forEach(p => {
    const score = latestScores.get(p.id) ?? (typeof p.score === 'number' ? p.score : 0);
    const wrap = document.createElement('div');
    wrap.className = 'avatar-wrap';
    wrap.innerHTML = `
      <img class="avatar border border-gray-200" src="${p.avatar}" alt="${p.name}" title="${p.name}" />
      <div class="score-badge">${score}</div>
    `;
    quizParticipants.appendChild(wrap);
  });
}

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
const qsName = qs.get('name');
const qsAvatar = qs.get('avatar');
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
const quizParticipants = document.getElementById('quizParticipants');

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
const celebrationLayer = document.getElementById('celebrationLayer');

// --- Client state ---
let myName = '';
let myAvatar = '';
let myId = null;
let myScore = 0;
let answered = false;
let deadlineTs = 0;
let timerInterval = null;
let startBtnInterval = null;
let lastQuestionIdx = -1;
let totalQuestions = 10;
let hasJoined = false;
let currentPhase = 'lobby';
let inRound = false;
// Track latest lobby and leaderboard data for results screen
let lastTopic = 'Technology';
let lastTopics = [];
let lastParticipants = [];
let latestScores = new Map(); // id -> score

// Auto-join helper so the user appears in Participants when lobby loads
function autoJoinIfNeeded() {
  if (hasJoined) return;
  let name = String(qsName || '').trim();
  let avatar = String(qsAvatar || '').trim();
  if (!name) {
    const suffix = String((Math.random() * 10000) | 0).padStart(4, '0');
    name = `Guest-${suffix}`;
  }
  myName = name;
  myAvatar = avatar;
  socket.emit('join', { name, avatar });
  hasJoined = true;
}

// --- Utilities ---
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }
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
  // Track scores only; do not render bottom strip
  latestScores = new Map(list.map(p => [p.id, p.score]));
  lastParticipants = list.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score }));
  const me = list.find(p => p.id === myId);
  if (me) {
    myScore = me.score;
    if (currentScoreDisplay) currentScoreDisplay.textContent = String(myScore);
  }
  // Update quiz participants badges in real-time
  try { renderQuizParticipants(); } catch {}
}

function renderLobby({ topics, topic, participants }) {
  // populate topics
  topicSelect.innerHTML = '';
  topics.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t; if (t === topic) opt.selected = true; topicSelect.appendChild(opt);
  });
  // participants (lobby shows avatars without score badges)
  lobbyParticipants.innerHTML = '';
  participants.forEach(p => {
    const img = document.createElement('img');
    img.src = p.avatar;
    img.alt = p.name;
    img.title = p.name;
    img.className = 'avatar border border-gray-200';
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
  if (playerNameDisplay) playerNameDisplay.textContent = myName;
  if (currentScoreDisplay) currentScoreDisplay.textContent = String(myScore);

  questionText.textContent = payload.question;
  try { questionText.classList.add('fade-in'); setTimeout(() => questionText.classList.remove('fade-in'), 500); } catch {}
  optionsContainer.innerHTML = '';
  payload.options.forEach((option, index) => {
    const optionCard = document.createElement('div');
    optionCard.className = 'option-card border-2 rounded-lg p-4 hover:border-indigo-500 fade-in';
    optionCard.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          <div class="flex-shrink-0 w-8 h-8 dark-option-label rounded-full flex items-center justify-center mr-3">
            <span class="text-sm font-semibold">${String.fromCharCode(65 + index)}</span>
          </div>
          <span class="text-slate-200">${option}</span>
        </div>
        <div class="points-feedback hidden"></div>
      </div>
    `;
    optionCard.addEventListener('click', () => onSelect(index, optionCard));
    optionsContainer.appendChild(optionCard);
  });

  setProgress(payload.index, payload.total);
  setTimerFromDeadline(payload.deadlineTs);
  statusHint.textContent = '';
  // ensure participants row is populated when a question displays
  try { renderQuizParticipants(); } catch {}
}

function onSelect(index, element) {
  if (answered) return;
  answered = true;
  // visual immediate selection
  document.querySelectorAll('.option-card').forEach(card => card.classList.remove('selected'));
  element.classList.add('selected');
  // send to server
  socket.emit('answer', { choice: index });
  // prevent double clicking
  try { document.querySelectorAll('.option-card').forEach(c => c.style.pointerEvents = 'none'); } catch {}
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
  // Not used for UI transitions anymore; countdown is shown on Start button
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
    try { startCelebration(); } catch {}
  } else {
    resultIcon.className = 'fas fa-thumbs-up text-6xl text-blue-500 mb-4';
    // hide celebration if present
    if (celebrationLayer) { celebrationLayer.classList.add('hidden'); celebrationLayer.innerHTML = ''; }
  }
  // also render topic/participants sections similar to lobby using last known data
  renderResultsMeta();
}

// --- Socket events ---
socket.on('connect', () => {
  myId = socket.id;
  try { console.log('[SOCKET] connected', { myId }); } catch {}
  // Ensure we are in the participants list immediately on fresh loads
  try { autoJoinIfNeeded(); } catch {}
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
  // Update list and topics always (render even before joining so lobby shows in embeds)
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
  const listed = Array.isArray(payload.participants) ? payload.participants.includes(myId) : true;
  // Keep lobby visible; show countdown on Start button text
  currentPhase = 'countdown';
  inRound = !!listed; // mark that we will join the upcoming round if listed
  try { updateStartButtonCountdown(payload.deadlineTs); } catch {}
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

// Immediate feedback for the answering player
socket.on('answerFeedback', ({ yourChoice, correctIndex, correct, delta }) => {
  try {
    const cards = Array.from(document.querySelectorAll('.option-card'));
    const chosen = cards[yourChoice];
    const correctEl = cards[correctIndex];
    if (chosen) {
      chosen.classList.add(correct ? 'correct' : 'incorrect');
      // use embedded points-feedback node for animated points
      const pf = chosen.querySelector('.points-feedback');
      if (pf) {
        pf.textContent = `${delta > 0 ? '+' : ''}${delta}pts`;
        pf.className = `points-feedback ml-3 font-semibold ${correct ? 'text-green-300' : 'text-red-300'}`;
        pf.classList.remove('hidden');
      }
    }
    if (!correct && correctEl) {
      correctEl.classList.add('correct');
    }
  } catch {}
});

// --- UI events ---
// Name form removed: joining is expected via postMessage from embedding parent.

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
      const score = latestScores.get(p.id) ?? (typeof p.score === 'number' ? p.score : 0);
      item.innerHTML = `
        <div class="avatar-wrap">
          <img class="avatar border border-gray-200" src="${p.avatar}" alt="${p.name}" />
          <div class="score-badge">${score}</div>
        </div>
        <div class="text-sm text-gray-800">${p.name}</div>
      `;
      lobbyParticipantsResults.appendChild(item);
    });
  }
}
