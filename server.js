const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve our frontend HTML, CSS, and JS files
app.use(express.static(__dirname));

// --- Game State ---
const ROUND_TIME = 90;
let gameState = {
    timeRemaining: ROUND_TIME,
    score1: 0,
    score2: 0,
    activeTeam: null,
    isPlaying: false,
    currentWords: []
};
let timerInterval = null;
let players = {};

const wordBank = [
    "ALGORITHM", "BANDWIDTH", "COMPILER", "DEBUGGING", "ENCRYPTION",
    "FIREWALL", "GIGABYTE", "HARDWARE", "INTERFACE", "JAVASCRIPT",
    "KEYBOARD", "LATENCY", "MAINFRAME", "NETWORK", "OPERATING",
    "PROTOCOL", "QUERY", "ROUTER", "SOFTWARE", "TERMINAL", "VARIABLE",
    "WIRELESS", "DATABASE", "FRONTEND", "BACKEND", "SERVER", "CLIENT",
    "MONKEY", "JUNGLE", "GUITAR", "ASTRONAUT", "TELESCOPE", "PIRATE"
];

// --- Utility ---
function compareTwoStrings(first, second) {
    first = first.replace(/\s+/g, '').toLowerCase();
    second = second.replace(/\s+/g, '').toLowerCase();
    if (first === second) return 1;
    if (first.length < 2 || second.length < 2) return 0;
    let firstBigrams = new Map();
    for (let i = 0; i < first.length - 1; i++) {
        const bigram = first.substring(i, i + 2);
        firstBigrams.set(bigram, firstBigrams.has(bigram) ? firstBigrams.get(bigram) + 1 : 1);
    }
    let intersectionSize = 0;
    for (let i = 0; i < second.length - 1; i++) {
        const bigram = second.substring(i, i + 2);
        const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) : 0;
        if (count > 0) {
            firstBigrams.set(bigram, count - 1);
            intersectionSize++;
        }
    }
    return (2.0 * intersectionSize) / (first.length + second.length - 2);
}

function generateGameWords() {
    const shuffled = [...wordBank].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 21).map((word, index) => ({
        id: `word-${index}`, word: word,
        points: Math.floor(Math.random() * 6 + 1) * 5,
        status: 'unguessed'
    }));
}

// --- Socket Logic ---
io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);
    
    // Add the new player to the server's tracking list and tell everyone
    players[socket.id] = { id: socket.id, name: `Player ${Math.floor(Math.random()*1000)}`, team: 1, role: 'guesser' };
    io.emit('lobbyUpdate', players);

    // Send the current state to the newly connected player immediately
    socket.emit('init', gameState);

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('lobbyUpdate', players);
    });

    socket.on('setName', (name) => {
        if (players[socket.id]) {
            players[socket.id].name = name;
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('joinTeam', (team, role) => {
        const teamCount = Object.values(players).filter(p => p.team === team).length;
        if (teamCount < 4 || players[socket.id].team === team) {
            players[socket.id].team = team;
            players[socket.id].role = role;
            io.emit('lobbyUpdate', players);
        }
    });

    socket.on('startRound', (teamNumber) => {
        if (gameState.isPlaying) return; // Prevent double starts
        
        // // Validate team has at least one describer and one guesser (Temporarily disabled for testing)
        // const teamPlayers = Object.values(players).filter(p => p.team === teamNumber);
        // const hasDescriber = teamPlayers.some(p => p.role === 'describer');
        // const hasGuesser = teamPlayers.some(p => p.role === 'guesser');

        // if (!hasDescriber || !hasGuesser) {
        //     socket.emit('error', 'The active team needs at least one Guesser and one Describer to start.');
        //     return;
        // }
        
        gameState = { ...gameState, timeRemaining: ROUND_TIME, activeTeam: teamNumber, isPlaying: true, currentWords: generateGameWords() };
        io.emit('gameStarted', gameState);
        
        timerInterval = setInterval(() => {
            gameState.timeRemaining--;
            io.emit('timerUpdate', gameState.timeRemaining);
            
            if (gameState.timeRemaining <= 0) {
                clearInterval(timerInterval);
                gameState.isPlaying = false;
                io.emit('gameEnded', gameState);
            }
        }, 1000);
    });

    socket.on('endRoundEarly', () => {
        if (gameState.isPlaying) {
            clearInterval(timerInterval);
            gameState.isPlaying = false;
            gameState.timeRemaining = 0;
            io.emit('timerUpdate', gameState.timeRemaining);
            io.emit('gameEnded', gameState);
        }
    });

    socket.on('guess', (guess) => {
        if (!gameState.isPlaying || !guess.trim()) return;
        const normalizedGuess = guess.trim().toUpperCase();
        
        const player = players[socket.id];
        // Only allow guesses from guessers on the currently active team
        if (!player || player.team !== gameState.activeTeam || player.role !== 'guesser') {
            return; 
        }

        let matched = false;
        const playerName = player.name || 'Unknown';

        gameState.currentWords.forEach(item => {
            if (item.status === 'correct') return;
            const similarity = compareTwoStrings(normalizedGuess, item.word);

            if (normalizedGuess === item.word) {
                const pointsAwarded = item.status === 'close' ? Math.ceil(item.points / 2) : item.points;
                if (gameState.activeTeam === 1) gameState.score1 += pointsAwarded; else gameState.score2 += pointsAwarded;
                item.status = 'correct';
                io.emit('feedUpdate', { word: item.word, points: pointsAwarded, status: 'correct', player: playerName });
                matched = true;
            } else if (similarity > 0.75 && item.status === 'unguessed') {
                const halfPts = Math.floor(item.points / 2);
                if (gameState.activeTeam === 1) gameState.score1 += halfPts; else gameState.score2 += halfPts;
                item.status = 'close';
                io.emit('feedUpdate', { word: item.word, points: halfPts, status: 'close', guessMade: normalizedGuess, player: playerName });
                matched = true;
            }
        });

        if (matched) {
            io.emit('stateUpdate', gameState);
        } else {
            // Send incorrect guesses only to members of the active team
            const activeTeamSocketIds = Object.values(players).filter(p => p.team === gameState.activeTeam).map(p => p.id);
            io.to(activeTeamSocketIds).emit('chatMessage', { player: playerName, text: guess });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));