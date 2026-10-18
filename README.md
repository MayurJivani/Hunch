# Hunch

![React](https://img.shields.io/badge/React-19-243B30?logo=react&logoColor=E8DCC0)
![Three.js](https://img.shields.io/badge/Three.js-0.186-243B30?logo=threedotjs&logoColor=E8DCC0)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-243B30?logo=socketdotio&logoColor=E8DCC0)
![TypeScript](https://img.shields.io/badge/TypeScript-7-243B30?logo=typescript&logoColor=E8DCC0)

A browser deduction game for 3 to 5 players, built on the mechanic of the board game *Cryptid*. A creature lives on one space of a hex map. Each player holds one private clue. Players question each other about spaces, read the cubes and discs that come back, and race to search the habitat.

The 3D map is the interface: you pick spaces on a miniature diorama, and every answer drops onto it as a piece. Answers are computed from typed clues, so nobody can answer wrongly by mistake.

- **Pass and play** on one device, with a hand-off screen that hides each clue.
- **Online rooms** with a four-letter code; the server holds the only copy of the clues and the habitat, and a refresh drops you back into your seat.
- **Every map is generated** from a seed and checked to have exactly one habitat, with no redundant clue.
- **Hard mode** follows the rulebook's advanced game: "not" clues and black structures.
- **A notebook** lists the clues each player's pieces still fit, the pen-and-paper tracking the rulebook recommends.
- **Sound**: synthesised event effects and calm CC0 background music, each with its own switch.
- A flat SVG map takes over when WebGL is unavailable.

## Run it

```bash
npm install
npm run dev
```

The client runs on http://localhost:5190 and the Socket.IO server on :4351.

```bash
npm test
```

```bash
npm run build && npm start
```

`npm start` serves the built client and the sockets from one process on `PORT` (default 4351).

How the rules engine, generator and privacy model work: [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

Rules follow the official rulebook (standard mode). Map art, names and copy are original; no official tiles, clue-book text or artwork are used.
