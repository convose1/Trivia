import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { QUESTIONS, TOPICS } from './questions.js';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// Serve static client
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientPath = path.resolve(__dirname, '../client');
app.use(express.static(clientPath));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// --- Game state ---
const ROOM_ID = 'global-room'; // single shared room for now
const QUESTION_TIME_SEC = 10;
const INTERMISSION_SEC = 2; // time to show correct answer before next question
const PRE_START_COUNTDOWN_SEC = 3; // shorter, simpler countdown
const QUESTIONS_PER_ROUND = 10;

const defaultRoomState = () => ({
  id: ROOM_ID,
  players: new Map(), // socketId -> { id, name, avatar, score, answeredForQuestion }
  questionSet: [],
  currentQuestionIndex: -1,
  phase: 'lobby', // lobby | countdown | question | reveal | finished
  deadlineTs: 0,
  timers: { phase: null },
  selectedTopic: 'Technology',
});

let room = defaultRoomState();

function resetRoomToLobby() {
  // stop any timers and reset to a fresh lobby state
  try { clearTimeout(room.timers?.phase); } catch {}
  room = defaultRoomState();
}

function broadcastLeaderboard() {
  const leaderboard = Array.from(room.players.values())
    .sort((a, b) => b.score - a.score)
    .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score }));
  io.to(ROOM_ID).emit('leaderboard', leaderboard);
}

function broadcastLobby() {
  const participants = Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
  io.to(ROOM_ID).emit('lobbyState', {
    topic: room.selectedTopic,
    topics: Object.keys(TOPICS),
    participants,
    phase: room.phase,
  });
}

function pickQuestionSet() {
  const pool = TOPICS[room.selectedTopic] || QUESTIONS;
  try {
    console.log('[server] pickQuestionSet()', {
      selectedTopic: room.selectedTopic,
      poolSize: Array.isArray(pool) ? pool.length : 'n/a',
    });
  } catch {}
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  room.questionSet = shuffled.slice(0, QUESTIONS_PER_ROUND);
  room.currentQuestionIndex = -1;
}

function startCountdown() {
  if (!(room.phase === 'lobby' || room.phase === 'finished')) return;
  if (room.players.size === 0) return;
  clearTimeout(room.timers.phase);
  room.phase = 'countdown';
  const startTs = Date.now();
  const deadlineTs = startTs + PRE_START_COUNTDOWN_SEC * 1000;
  room.deadlineTs = deadlineTs;
  const participants = Array.from(room.players.keys());
  console.log('[server] starting countdown', { phase: room.phase, participants: participants.length, deadlineTs });
  io.to(ROOM_ID).emit('countdown', { deadlineTs, participants });
  room.timers.phase = setTimeout(() => startRound(), PRE_START_COUNTDOWN_SEC * 1000);
}

function startRound() {
  pickQuestionSet();
  for (const p of room.players.values()) {
    p.score = 0;
  }
  broadcastLeaderboard();
  nextQuestion();
}

function nextQuestion() {
  clearTimeout(room.timers.phase);
  room.currentQuestionIndex += 1;
  if (room.currentQuestionIndex >= room.questionSet.length) {
    finishRound();
    return;
  }
  // reset per-question state
  for (const p of room.players.values()) {
    p.answeredForQuestion = null; // { choice, correct, delta }
  }

  const q = room.questionSet[room.currentQuestionIndex];
  room.phase = 'question';
  const deadlineTs = Date.now() + QUESTION_TIME_SEC * 1000;
  room.deadlineTs = deadlineTs;

  const { question, options } = q;
  io.to(ROOM_ID).emit('question', {
    index: room.currentQuestionIndex,
    total: room.questionSet.length,
    question,
    options,
    deadlineTs,
  });

  room.timers.phase = setTimeout(() => reveal(), QUESTION_TIME_SEC * 1000);
}

function reveal() {
  clearTimeout(room.timers.phase);
  room.phase = 'reveal';
  const q = room.questionSet[room.currentQuestionIndex];

  // apply timeout penalties for those who didn't answer
  for (const p of room.players.values()) {
    if (!p.answeredForQuestion) {
      p.score -= 2;
      p.answeredForQuestion = { choice: null, correct: false, delta: -2, timeout: true };
    }
  }
  broadcastLeaderboard();

  // Prepare per-player results for this question
  const perPlayer = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    choice: p.answeredForQuestion?.choice ?? null,
    correct: p.answeredForQuestion?.correct ?? false,
    delta: p.answeredForQuestion?.delta ?? -2,
    timeout: p.answeredForQuestion?.timeout ?? false,
    score: p.score,
  }));

  io.to(ROOM_ID).emit('reveal', {
    correctIndex: q.correct,
    perPlayer,
  });

  room.timers.phase = setTimeout(() => nextQuestion(), INTERMISSION_SEC * 1000);
}

function finishRound() {
  clearTimeout(room.timers.phase);
  room.phase = 'finished';
  const final = Array.from(room.players.values())
    .sort((a, b) => b.score - a.score)
    .map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score }));
  io.to(ROOM_ID).emit('gameOver', { final });
}

io.on('connection', (socket) => {
  // Join global room
  socket.join(ROOM_ID);

  socket.on('join', ({ name, avatar }) => {
    const player = {
      id: socket.id,
      name: String(name || 'Player').slice(0, 30),
      avatar: typeof avatar === 'string' && avatar.startsWith('http') ? avatar : `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(name || uuidv4())}`,
      score: 0,
      answeredForQuestion: null,
    };
    room.players.set(socket.id, player);
    socket.emit('joinedSelf', { id: socket.id });
    broadcastLeaderboard();
    broadcastLobby();

    // Keep new joiners in lobby no matter the current phase; they will join next round when it starts
    socket.emit('lobbyState', {
      topic: room.selectedTopic,
      topics: Object.keys(TOPICS),
      participants: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
      phase: room.phase,
    });
  });

  socket.on('answer', ({ choice }) => {
    if (room.phase !== 'question') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    if (player.answeredForQuestion) return; // already answered

    let idx = Number(choice);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;

    const q = room.questionSet[room.currentQuestionIndex];
    const correct = idx === q.correct;
    const delta = correct ? 10 : -2;
    player.score += delta;
    player.answeredForQuestion = { choice: idx, correct, delta, timeout: false };

    // live update leaderboard for excitement
    broadcastLeaderboard();

    // immediate feedback to the answering player only
    io.to(socket.id).emit('answerFeedback', {
      yourChoice: idx,
      correctIndex: q.correct,
      correct,
      delta,
    });
  });

  socket.on('setTopic', ({ topic }) => {
    if (room.phase !== 'lobby' && room.phase !== 'finished') return;
    if (!TOPICS[topic]) return;
    room.selectedTopic = topic;
    try { console.log('[server] setTopic received', { topic }); } catch {}
    broadcastLobby();
  });

  socket.on('startGame', () => {
    console.log('[server] startGame received', { from: socket.id, phase: room.phase, players: room.players.size });
    if (room.phase !== 'lobby' && room.phase !== 'finished') return;
    startCountdown();
  });

  socket.on('disconnect', () => {
    room.players.delete(socket.id);
    broadcastLeaderboard();
    if (room.players.size === 0) {
      // If the last player left, end the game and reset to lobby
      resetRoomToLobby();
    }
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`Multiplayer TechQuiz server listening on http://localhost:${PORT}`);
});
