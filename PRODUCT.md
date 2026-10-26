# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + TypeScript + Vite for the client, Three.js for the board (OrbitControls, Raycaster, InstancedMesh), GSAP for motion, a Node process running Socket.IO for online rooms, Zod at the socket boundary. Pinned by the project brief.

## Users

People playing a deduction board game together: friends who already know Cryptid and want it in a browser, and newcomers who have never played and need the rules taught as they go. Played around a table on one shared device (pass and play) or apart on their own laptops and phones (online room).

## Product Purpose

A browser version of the Cryptid deduction mechanic. Each player holds one private clue; together the clues point at exactly one habitat space on a shared hex map. Players question each other about spaces and read the cube or disc answers until someone searches the right space. Success: a group finishes a fair game with no rules disputes and no leaked secrets.

## Positioning

The map is the interface. Every action (question, search, penalty cube) is taken on the board, and answers are computed from typed clues, so nobody can answer wrongly by mistake, which is the most common way the physical game breaks.

## Operating Context

A game takes 20 to 40 minutes. In pass and play the device changes hands, so private information must hide behind a hand-off screen. Online, players may drop and rejoin mid-game.

## Capabilities and Constraints

- Standard rules only for now (3 to 5 players, positive clues, white/green/blue structures). Advanced mode (negative clues, black structures) is deliberately undecided.
- Every board is generated from a seed and must have exactly one habitat; clue sets are also rejected when any clue is redundant.
- The server owns online game state; clients never receive another player's clue or the habitat until the game ends.
- Public hunts: any number of hunters (load-tested at 400 per hunt) share one board and receive the same public clue sequence on a server clock; the first correct guess wins. The private game's rules and secrecy are untouched.
- Original art, names and copy only. No official map tiles, clue-book text, logos or artwork.

## Brand Commitments

Name: "Hunch" (renamed from the working title "Field Notes: The Cryptid Hunt" on 2026-10-17). Visual direction replaced on 2026-10-17 by the user's rehaul brief: a vivid, living low-poly wilderness on a floating island, with a dark navy and blue-green interface foundation and the colour supplied by the terrain. Explicitly retired: brown parchment, the wooden board frame, beige panels and muted colours. Board-first play: every primary action happens on the board through contextual controls, with no persistent action toolbar.

## Evidence on Hand

No art assets supplied. Everything visual is authored in code. Background music is two CC0 tracks from Wikimedia Commons (listed in public/sounds/CREDITS.md); every sound effect is synthesised; fonts (Unbounded, Figtree, SIL OFL) are self-hosted in public/fonts.

## Product Principles

1. Rules correctness before presentation.
2. The board must stay readable: terrain, boundaries, structures and markers never hide each other.
3. Secrets stay secret, on the server and on a shared screen.
4. A newcomer can play their first game without reading a manual first.

## Accessibility & Inclusion

Player identity uses colour plus a shape glyph. Keyboard play for the whole game, a non-3D description of the selected space, reduced-motion support, large touch targets.
