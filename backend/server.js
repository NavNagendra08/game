// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const stringSimilarity = require('string-similarity');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Game State Storage
const rooms = {};

const WORDS = ["BANANA", "JUNGLE", "GUITAR", "ASTRONAUT", "TELESCOPE", "MONKEY", "PIRATE"];

// Helper: Evaluate Guess
function evaluateGuess(guess, targetWord) {
  const normalizedGuess = guess.toUpperCase().trim();
  if (normalizedGuess === targetWord) return 'correct';
  
  // Use string similarity for typos / close guesses (> 0.75 similarity is usually close)
  const similarity = stringSimilarity.compareTwoStrings(normalizedGuess, targetWord);
  if (similarity > 0.75) return 'close';
  
  return 'wrong';
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join Room & Team
  socket.on('join_room', ({ roomId, username, team }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {},
        state: 'lobby', // lobby, playing, end
        round: 1,
        teamScores: { A: 0, B: 0 },
        currentExplainer: null,
        currentWord: '',
        timeLeft: 60,
        timerInterval: null
      };
    }
    
    rooms[roomId].players[socket.id] = { id: socket.id, username, team, score: 0 };
    io.to(roomId).emit('room_update', rooms[roomId]);
  });

  // Start Game & Turn Rotation
  socket.on('start_game', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    
    room.state = 'playing';
    // Pick a random explainer
    const playerIds = Object.keys(room.players);
    room.currentExplainer = playerIds[Math.floor(Math.random() * playerIds.length)];
    
    // Send random words to the explainer to choose from
    const wordChoices = WORDS.sort(() => 0.5 - Math.random()).slice(0, 3);
    io.to(room.currentExplainer).emit('choose_word', wordChoices);
    io.to(roomId).emit('room_update', room);
  });

  // Explainer selects word, start timer
  socket.on('word_selected', ({ roomId, word }) => {
    const room = rooms[roomId];
    room.currentWord = word;
    room.timeLeft = 60;
    
    io.to(roomId).emit('round_started');
    
    room.timerInterval = setInterval(() => {
      room.timeLeft--;
      io.to(roomId).emit('timer_tick', room.timeLeft);
      
      if (room.timeLeft <= 0) {
        clearInterval(room.timerInterval);
        io.to(roomId).emit('round_ended', { reason: 'timeout', word: room.currentWord });
        // Logic for next turn goes here
      }
    }, 1000);
  });

  // Handle Guesses
  socket.on('send_guess', ({ roomId, guess }) => {
    const room = rooms[roomId];
    const player = room.players[socket.id];
    
    // Explainer can't guess
    if (socket.id === room.currentExplainer) return;

    const status = evaluateGuess(guess, room.currentWord);
    let points = 0;

    if (status === 'correct') {
      points = Math.floor(room.timeLeft * 2); // Faster guess = more points
      player.score += points;
      room.teamScores[player.team] += points;
      
      // Award explainer
      room.players[room.currentExplainer].score += 50; 
      
      clearInterval(room.timerInterval);
      io.to(roomId).emit('round_ended', { reason: 'guessed', word: room.currentWord, winner: player.username });
    } else if (status === 'close') {
      points = 5; // Small points for close guesses
      player.score += points;
    }

    // Broadcast guess to chat
    io.to(roomId).emit('chat_message', {
      username: player.username,
      guess: guess,
      status: status, // 'correct', 'close', 'wrong'
      points: points
    });
    
    io.to(roomId).emit('room_update', room);
  });

  // WebRTC Signaling for Voice Chat
  socket.on('webrtc_signal', ({ target, signal, caller }) => {
    io.to(target).emit('webrtc_signal', { signal, caller });
  });

  socket.on('disconnect', () => {
    // Handle cleanup
    console.log('User disconnected:', socket.id);
  });
});

server.listen(3001, () => console.log('Server running on port 3001'));
