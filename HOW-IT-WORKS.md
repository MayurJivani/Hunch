# How it works

## Layout

```text
shared/   board.ts    hex grid, seeded map generator, clue library, puzzle generator
          engine.ts   turn rules, legality, player views (pure, used by server and client)
          protocol.ts Zod schemas for every socket message
          hunt.ts     public hunts: clue sequence generator, rule sets, guess feedback, wire types
server/   index.ts    one Node process: Socket.IO plus static files in production
          rooms.ts    rooms, seats, reconnect tokens, rate limiting
          public.ts   public hunts: clue clock, guess judging, winner, stats and leaderboards
src/      board3d.ts  Three.js diorama (instanced tiles, picking, pieces, GSAP motion)
          board2d.ts  SVG fallback with the same interface, used without WebGL
          Game.tsx    game screen; App.tsx home, pass-and-play curtain, online lobby
          Public.tsx  public hunt screen, home sheet, reveal and leaderboard
tests/    engine.test.ts, rules.test.ts, rooms.test.ts, hunt.test.ts, public.test.ts (node:test, no framework)
scripts/  load-public.ts  a 400-hunter hunt against a real server process (npm run load)
```

Node 22.18+ runs the TypeScript in `shared/`, `server/` and `tests/` directly (type stripping), so the server has no build step and tests need no runner.

## The map

12 columns by 9 rows of flat-topped hexes in odd-q offset (odd columns sit half a hex lower), stored as `index = row * 12 + col` and converted to axial coordinates for distance. A map is fully determined by its seed:

1. **Terrain**: 15 patches (3 per terrain) take turns claiming a neighbouring space. Patches can get boxed in, so the generator redraws (at most 60 times) until every terrain covers 15 to 29 spaces.
2. **Animal territories**: 3 bear and 3 cougar patches of 2 or 3 spaces, never touching each other.
3. **Structures**: a standing stone and an abandoned shack in each of white, green and blue (standard mode uses three of each type), at least 3 spaces apart and off water.

## Clues

The 23 standard clues are typed constraints, not strings: `{ within: n, test: hex => boolean }`. "Within n" counts the feature's own space, as the rulebook states. Families: on one of two terrains (10), within one space of a terrain (5), within one space of either animal territory (1), within two spaces of a stone or shack (2), within two spaces of bear or cougar territory (2), within three spaces of a structure colour (3).

## Puzzles

`generateScenario(seed, players, secret)` draws distinct clues until exactly one space satisfies all of them **and** every clue is needed (dropping any one leaves at least two candidates). It tries 3000 clue sets per map and 40 maps, then throws rather than looping forever. The test suite checks 120 seeds.

The clue draw is seeded by `secret`, never by the board seed. Every client receives the board (and its seed, for decoration), so a draw derived from it could be rerun in a browser to read every clue and the habitat. The server picks the secret separately and never sends it.

## Turn rules

From the official rulebook, enforced by `illegal()` and `apply()`:

- Setup: in turn order, everyone places two cubes on spaces their clue rules out.
- A space holding any cube is closed: no questions, searches or pieces there. One cube per space; you never put a second piece of your own on a space.
- **Question**: pick a space and another player. A disc means their clue allows it; a cube means it does not, and then the asker owes a penalty cube on a space their own clue rules out.
- **Search**: only on a space your clue allows. If you already have a disc there, you first place a disc on another space your clue allows. Others answer clockwise, skipping anyone with a disc already there; the first cube ends the search and you owe a penalty cube. All discs means you win.
- The rulebook does not cover a penalty with no legal space left; the engine logs it and skips the penalty rather than deadlock.

`apply()` clones the state and throws on an illegal action, so a rejected action never mutates anything.

## Hard mode

The rulebook's advanced game. `generateBoard(seed, 'hard')` places a black standing stone and a black shack as well (eight structures), and `cluesFor('hard')` is all 48 clues: the 24 positive ones (black added to the colour clues) and a "not" form of each, which allows exactly the spaces its positive form rules out. A hard game always deals at least one "not" clue. In both modes, a clue is only dealt if it leaves its owner room for two opening cubes. The host picks the mode when starting an online room; the server validates it with Zod.

## Notebook and sound

The notebook (`src/notes.ts`) filters each player's possible clues by the discs and cubes they have placed, and can fade every space that no longer fits your clue plus some possible clue of every other player. It only reads public pieces. Sound effects (`src/sound.ts`) are synthesised with WebAudio, so they cost no downloads: a soft tick for every button, tab and toggle, a tone for picking a space, knocks and clacks timed to each piece's drop, a ping for questions, a falling motif for a failed search, an arpeggio for the find and a chime when the move comes to you. Background music is two calm CC0 tracks (Rafael Archangel's "Calm Down" and Komiku's "Chill Out Theme", about 4.4 MB together; see `public/sounds/CREDITS.md`), streamed through an audio element, alternated, faded in, and paused while the tab is hidden. Effects and music have separate switches, remembered on the device, and both start only after the first tap, as browsers require.

## Rules compliance

`tests/rules.test.ts` re-implements the rulebook (standard and advanced modes) independently of the engine: hex distance from plane geometry, clue semantics from the "Possible clues" section, and legality and resolution from "Playing the game", "Core principles", "Questioning" and "Searching". It then plays 60 random three to five player games (half in hard mode) and, at every step, checks the engine against that oracle for every possible action by every player. It also checks honesty (every piece agrees with its owner's clue), that pieces are never removed, that the player to act always has a legal move, and that no view leaks another clue. `tests/rooms.test.ts` plays a whole online game over sockets with each seat acting only on its own view.

Two situations the rulebook does not cover are decided here: a penalty cube owed with no legal space left is skipped (logged), and a searcher with a disc already on the space but no other legal space for the extra disc goes straight to the answers. Optional hints and mistake correction are not implemented; answers are computed, so mistakes cannot happen.

## Privacy

`GameState` holds every clue and the habitat. `viewFor(state, seat)` returns a `PlayerView` with other players' clues set to `null` and the habitat withheld until the game ends. `illegal()` only reads the acting player's own clue, so the client can run the same legality checks on its masked view to explain disabled buttons.

The production server also refuses frames from other origins (`frame-ancestors 'none'`), sends a strict CSP and permissions policy, caps sockets per address and rooms per connection and overall, and treats a malformed URL as a normal miss rather than an exception.

Online, the server keeps the only `GameState` and sends each socket a view built for its seat. Reconnect tokens are 24 random bytes, stored only as SHA-256 digests and compared in constant time. Every message is parsed by a Zod schema and rate limited (token bucket, 8 per second, bursts of 16). Node is single-threaded and `apply()` is synchronous, so two requests can never interleave; a repeated request is re-validated against the new state and refused. Rooms with nobody connected are removed after two hours.

In pass and play the full state lives in the browser, by necessity; a hand-off screen hides the board's private overlay and clue whenever the acting player changes.

## The board

A floating low-poly island. Each terrain is one `InstancedMesh` of a beveled hex platform at that terrain's height (`userData.spaces` maps an instance to its space), so picking is one raycast over five meshes. Under every tile hangs a tapered rock column, deeper toward the middle, so the board reads as one island. Water tiles are the pale shore; an inset lake surface (deep blue centre, turquoise rim) carries drifting glints from a small shader patch, and lakes on the rim spill off as scrolling waterfalls.

Props are built once from primitives merged into one vertex-coloured geometry each (pine, bush, flower, peak, boulder, shard, cactus, reeds, pool, lily pad, jetty) and drawn as one instanced mesh per kind. Placement is seeded from the board, so it is identical across renders, reconnects and devices. Props only use the rim of a space (the centre is for pieces); tall props take the slots facing away from the camera and never stand on a structure's space. Contact pools darken the ground under props and piece stacks.

Ambient life runs in the render loop and never touches React: foliage sways in a vertex shader with a per-instance phase, birds fly curved loops and now and then land on a treetop or peak, clouds drift below the island (where they overlap it, the island hides them), warm motes float above it, and the sun's intensity breathes slowly. Light is a warm low sun with soft shadows, a cool fill and a blue-green bounce, through `NeutralToneMapping` so colours stay saturated. The shadow map renders once and again only when a piece lands.

Gameplay feedback: hover is a soft luminous edge; selection is a cyan band edged in navy with a pulsing glow; a Question raises a brief column of light as the piece drops; a failed Search sends a coral shockwave and a shiver through the pieces; a found habitat gets a gold pillar, a burst of sparks, a warmer sun and the camera settling on it. With reduced motion the scene renders a composed still (no birds, no sway) and the effects are skipped.

Bear territory is a solid band and cougar a dashed one, each over an ivory underlay. Player pieces carry a cream glyph on a dark disc and grow 1.3x on touch screens. On portrait screens the board turns a quarter so its long side runs down the screen; the floating labels and the arrow keys follow.

## The interface

The board is the interface. A floating glass nav pill holds the wordmark, the turn strip and four icon buttons (log, rules, reset view, leave). Selecting a space opens a popover that the scene repositions over that space every frame; it shows the space, its pieces and your clue's verdict, and only the actions legal right now, with one line explaining any that are not. On phones it docks as a bottom sheet. The latest answer appears as a short toast; the full history lives in an optional log drawer. The home page renders the same island in a slow drifting showcase camera, and starting a game dives the camera in before the board takes over.

## Public hunts

The private game deals each player a different clue. A public hunt does the opposite: everyone receives the same clues at the same moment, and the race is who reads them fastest. It reuses the board generator, the clue library and `clueMap()` unchanged; only the clue sequence is new.

**The sequence.** `generateHunt(seed, secret)` builds a standard board, then shuffles every positive and "not" clue (black excluded, standard boards have no black structures) and walks the list keeping a clue only if it removes at least one remaining space and no more than three quarters of them, until one space is left. It accepts 5 to 7 clues with at least 3 spaces still open before the last, so the final clue always matters and an early guess is a real gamble. As in the private game, the draw comes from a server-only `secret`, so the public board seed cannot be rerun to read the answer. `tests/hunt.test.ts` checks 150 hunts: every clue is true at the habitat, each one narrows the field, and the last leaves exactly one space.

**The clock.** A hunt opens with a briefing (20 s by default) for hunters to arrive, then the server drops clue 1, then one clue every 30 s, then allows 60 s after the last before it times out and reveals. Every drop is one broadcast to the hunt's Socket.IO room, so everyone gets clue n in the same send; a late arrival gets the clues already out and nothing ahead. Deadlines are server timestamps and each state carries the server's `now`, so clients count down on the server clock.

**Guesses.** A guess is a space and a client nonce. The server checks the phase, the hunter's cooldown and shots left, refuses a space already tried, measures hex distance to the habitat and replies with a hint only: near or far within two spaces (First to Find), scorching to cold in five bands (Hot or Cold), or nothing (One Shot, one guess). Distance and direction never leave the server before the reveal; hex distance is symmetric, so a band cannot point anywhere. A resent nonce gets the stored reply, so a retry after a dropped answer is never counted twice. Misses cost time: First to Find waits 4 s after the first miss and 3 s more for each after that (capped at 20 s), Hot or Cold always waits 10 s.

**The winner.** Node runs each handler synchronously, so guesses are judged strictly in the order the server reads them. The first correct one ends the hunt on the spot; a correct guess read even a millisecond later finds the hunt over and is refused. That arrival order is the tie-break, applied the same way every time. The reveal then sends the habitat, the full clue list, the winner and time, a 108-space count of every guess (the crowd heat map) and each hunter's best miss. Nobody sees anyone else's guesses before that, so there is no crowd to follow.

**Hunters.** No account. The first join issues a random 24-byte token, kept in the browser and stored on the server only as a SHA-256 digest, mapped to a random public id. Tabs and reconnects with the same token are the same hunter with the same attempts, so a second tab buys nothing. A refresh or a dropped socket resumes the same hunt and history. Hunter counts go out as one aggregated pulse per hunt at most once a second, never per player.

**Capacity.** `PUBLIC_CAPACITY` (default 400) hunters per hunt; a full hunt opens a parallel one of the same rule set. At most 200 hunts and 20 000 hunter records exist at once; finished hunts are swept after 15 minutes. Tokens that never reach a result are pruned, so join spam cannot grow the store. `SOCKETS_PER_IP` (default 24) is the private rooms' existing per-address cap; raise it for an event where a crowd shares one network.

**Stats and leaderboards.** When a hunt ends, everyone who guessed gets an entry, a win, a streak update, a fastest solve, clues used and miss distances, kept per rule set so one mode cannot farm another's board. The leaderboard shows wins today, this week and all time, the fastest solves, and the sharpest hunters (lowest average miss, five misses minimum). It is a flat JSON file (`PUBLIC_DATA`, default `data/public.json`, written atomically every couple of seconds after a change), the relay shape's store for what must survive a restart. A hunt in progress does not survive a restart.

**Load test.** `npm run load` starts the real server as a child process and plays one hunt with 400 socket clients: all join, all miss at once, all drop and reconnect at once, then all work out the answer from the public clues and fire together. On a desktop machine: joins p95 31 ms, clue 2 reached all 400 within 16 ms of each other, 400 simultaneous misses p95 11 ms, 400 reconnects p95 21 ms, 400 simultaneous correct guesses produced exactly 1 winner (p95 22 ms) and every hunter saw the reveal 25 ms after firing; the server used 1.4% of one core and grew from 114 to 169 MB. The largest state payload is 4 KB.

**The screen.** The same island, nav pill and popover as the private game. The case file (bottom left) lists clues as they drop; choosing one mists the spaces it rules out, one clue at a time, because combining them is the puzzle. A new clue arrives as a banner under the nav that mists its own region for a moment, then glides into the case file. Selecting a space opens the popover with a gold Guess button, so a stray tap never counts; One Shot asks once more before locking in. Misses stay on the map as "not here" cubes, the piece the private game uses for the same meaning. At the reveal the gold habitat pillar rises, and a panel tells who found it, replays the clues on the board one by one, and shows the crowd's heat map with the most-guessed space.

`PUBLIC_PACE` scales the whole clock (0.25 runs it four times faster), for demos and local testing.

## Dev review states

In development, `?demo=<seed>&steps=<n>` starts a four-player local game and auto-plays `n` legal moves, for screenshots and UI checks.
