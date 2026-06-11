# 🔍 Word Suspect – Social Deduction Party Game

A polished, real-time multiplayer party game inspired by Among Us & Spyfall. Players give clues about their secret words while one impostor tries to blend in with a *different* related word.

## 🚀 Quick Start

Simply open `index.html` in a browser. No build step or server required.

### Option A: Firebase Realtime Database (Recommended for real multiplayer)

1. Go to [firebase.google.com](https://console.firebase.google.com) and create a free project
2. Enable **Realtime Database** in test mode
3. Open the game → enter your Firebase **API Key**, **Project ID**, and **Database URL**
4. Click **Connect & Play**

### Option B: Single-Device Demo Mode

Click **Single-Device Demo Mode** to play locally with all players on the same device/computer. Perfect for testing.

---

## 🎮 How to Play

### Host
1. Click **Host Game** → enter your name → **Create Room**
2. Share the **Room Code** with all players
3. Configure settings (impostor mode, timer duration)
4. Click **Start Game** when everyone has joined

### Players
1. Click **Join Game** → enter your name + room code → **Join Room**
2. Wait in the lobby for the host to start

### Gameplay
1. Each player taps their word card to secretly reveal their word
2. Players take turns giving one verbal clue about their word
3. Discuss! Try to figure out who has the different word
4. The host opens voting when ready
5. Everyone votes for the suspected impostor
6. Results are revealed — was the impostor caught?

---

## 📦 File Structure

```
game/
├── index.html   – All game screens and UI
├── style.css    – Full animated styling (Nunito + Fredoka One fonts)
├── app.js       – Game logic, Firebase sync, state management
└── words.js     – Word pair database (60 pairs across 3 rounds)
```

---

## 🎯 Features

| Feature | Details |
|---|---|
| **Real-time sync** | Firebase Realtime Database keeps all devices in sync |
| **Unlimited players** | Works for small groups to large hall events |
| **3 Round types** | Everyday Objects → Animals → Chaos Round |
| **3 Attempts per round** | Impostor wins after 3 failed votes |
| **Discussion timer** | Configurable (2–10 min), with final-minute/10-sec warnings |
| **Voting system** | Anonymous, one vote per player, live tally |
| **Host controls** | Pause timer, skip round, reset, remove players |
| **Manual impostor** | Host can hand-pick who gets the different word |
| **Animations** | Confetti on win, floating shapes, animated timer ring |
| **Responsive** | Works on mobile, tablet, laptop, large screens |

---

## 🔧 Firebase Setup (Free)

1. Visit https://console.firebase.google.com
2. Create a new project (any name)
3. Go to **Build → Realtime Database → Create Database** → choose "Start in test mode"
4. Go to **Project Settings → Your apps → Add app (Web)**
5. Copy: **apiKey**, **projectId**, **databaseURL**
6. Paste into the game's Firebase Setup modal

Your config is saved in localStorage for future visits.
