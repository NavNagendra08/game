const socket = io();

// --- DOM Elements ---
const els = {
    timer: document.getElementById('timer'),
    score1: document.getElementById('score1'),
    score2: document.getElementById('score2'),
    cardGrid: document.getElementById('card-grid'),
    feedList: document.getElementById('feed-list'),
    inputArea: document.getElementById('input-area'),
    guessInput: document.getElementById('guess-input'),
    summaryModal: document.getElementById('summary-modal'),
    summaryBody: document.getElementById('summary-body'),
    finalScoreVal: document.getElementById('final-score-val'),
    restartBtn: document.getElementById('restart-btn'),
    lobbyModal: document.getElementById('lobby-modal'),
    cardsWrapper: document.getElementById('cards-wrapper'),
    contributionsWrapper: document.getElementById('contributions-wrapper'),
    endTestBtn: document.getElementById('end-test-btn')
};

let myRole = 'guesser';
const ROUND_TIME = 90;

// --- Socket Listeners ---
const sounds = {
    correct: new Audio('/audio/correct.mp3'),
    close: new Audio('/audio/close.mp3'),
    start: new Audio('/audio/start.mp3'),
    end: new Audio('/audio/end.mp3'),
    chat: new Audio('/audio/chat.mp3')
};

function playSound(type) {
    if (sounds[type]) {
        sounds[type].currentTime = 0; // Reset to start if already playing
        sounds[type].play().catch(err => console.warn("Sound playback blocked by browser:", err));
    }
}

socket.on('init', (state) => updateBoardState(state));
socket.on('stateUpdate', (state) => updateBoardState(state));
socket.on('timerUpdate', (time) => {
    els.timer.innerText = time;
    const percent = ((ROUND_TIME - time) / ROUND_TIME) * 100;
    document.getElementById('timer-bar').style.width = `${percent}%`;
});
socket.on('feedUpdate', (data) => {
    addFeedEntry(data);
    playSound(data.status); // 'correct' or 'close'
});
socket.on('chatMessage', ({ player, text }) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${player}:</strong> ${text}`;
    els.feedList.prepend(li);
    playSound('chat');
});
socket.on('error', (message) => {
    alert(`Error: ${message}`);
});

socket.on('lobbyUpdate', (players) => {
    const me = players[socket.id];
    if (me) myRole = me.role;
    
    const t1 = Object.values(players).filter(p => p.team === 1);
    document.getElementById('t1-count').innerText = t1.length;
    document.getElementById('team-1-list').innerHTML = t1.map(p => `<li>${p.name} <span class="role-badge role-${p.role}">${p.role}</span></li>`).join('');
    
    const t2 = Object.values(players).filter(p => p.team === 2);
    document.getElementById('t2-count').innerText = t2.length;
    document.getElementById('team-2-list').innerHTML = t2.map(p => `<li>${p.name} <span class="role-badge role-${p.role}">${p.role}</span></li>`).join('');
});

socket.on('gameStarted', (state) => {
    updateBoardState(state);
    els.feedList.innerHTML = '';
    els.summaryModal.classList.add('hidden');
    playSound('start');
});

socket.on('gameEnded', (state) => {
    els.inputArea.classList.add('disabled');
    els.inputArea.style.display = 'none';
    els.guessInput.disabled = true;
    showSummary(state);
    playSound('end');
});

// --- UI Updaters ---
function updateBoardState(state) {
    els.score1.innerText = state.score1;
    els.score2.innerText = state.score2;
    // Highlight the active team's score
    document.getElementById('score1').parentElement.style.color = state.activeTeam === 1 ? 'var(--accent-primary)' : 'var(--text-muted)';
    document.getElementById('score2').parentElement.style.color = state.activeTeam === 2 ? 'var(--accent-primary)' : 'var(--text-muted)';
    els.timer.innerText = state.timeRemaining;
    
    const percent = ((ROUND_TIME - state.timeRemaining) / ROUND_TIME) * 100;
    document.getElementById('timer-bar').style.width = `${percent}%`;
    
    if (state.isPlaying) {
        els.lobbyModal.classList.add('hidden');
        els.endTestBtn.style.display = 'block';
        
        if (myRole === 'describer') {
            els.cardsWrapper.style.display = 'block';
            els.contributionsWrapper.style.display = 'none';
            els.inputArea.style.display = 'none';
        } else {
            els.cardsWrapper.style.display = 'none';
            els.contributionsWrapper.style.display = 'flex';
            els.inputArea.style.display = 'block';
            els.inputArea.classList.remove('disabled');
            els.guessInput.disabled = false;
        }
    } else {
        els.endTestBtn.style.display = 'none';
    }

    els.cardGrid.innerHTML = '';
    state.currentWords.forEach(item => {
        const card = document.createElement('div');
        card.className = `card ${item.status !== 'unguessed' ? item.status : ''}`;
        card.innerHTML = `
            <div class="word-text">${item.word}</div>
            <div class="points-text">${item.points} pts</div>
        `;
        els.cardGrid.appendChild(card);
    });
}

function addFeedEntry({ word, points, status, guessMade, player }) {
    const li = document.createElement('li');
    li.className = status === 'close' ? 'feed-close' : 'feed-correct';
    li.innerHTML = status === 'close' 
        ? `Typo: <strong>${player}</strong> guessed <strong>${guessMade}</strong> for <em>${word}</em> (+${points})`
        : `Guessed: <strong>${player}</strong> found <strong>${word}</strong> (+${points})`;
    els.feedList.prepend(li);
}

function showSummary(state) {
    els.summaryBody.innerHTML = '';
    const finalScore = state.activeTeam === 1 ? state.score1 : state.score2;
    els.finalScoreVal.innerText = finalScore;
    state.currentWords.forEach(item => {
        const tr = document.createElement('tr');
        let ptsEarned = item.status === 'correct' ? item.points : (item.status === 'close' ? Math.floor(item.points / 2) : 0);
        tr.innerHTML = `
            <td>${item.word}</td>
            <td style="color: ${ptsEarned > 0 ? 'var(--color-correct)' : 'inherit'}">${ptsEarned} / ${item.points}</td>
            <td><span class="status-badge ${item.status}">${item.status.toUpperCase()}</span></td>
        `;
        els.summaryBody.appendChild(tr);
    });
    els.summaryModal.classList.remove('hidden');
}

// --- Event Listeners ---
els.endTestBtn.addEventListener('click', () => socket.emit('endRoundEarly'));

els.restartBtn.addEventListener('click', () => {
    els.summaryModal.classList.add('hidden');
    els.lobbyModal.classList.remove('hidden');
});

document.getElementById('save-name-btn').addEventListener('click', () => {
    const name = document.getElementById('player-name').value;
    if (name.trim()) socket.emit('setName', name.trim());
});

document.getElementById('invite-btn').addEventListener('click', (e) => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        const btn = e.target;
        btn.innerText = 'Copied!';
        setTimeout(() => btn.innerText = 'Copy Invite Link', 2000);
    });
});

els.guessInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
        const guess = e.target.value;
        if (guess.trim()) {
            socket.emit('guess', guess);
            e.target.value = ''; 
        }
    }
});