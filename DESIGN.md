---
name: "Hunch"
description: "A living low-poly island you play a deduction game on, with the interface floating over it in dark glass."
colors:
  cyan: "#5ce1e6"
  gold: "#ffc857"
  coral: "#ff7a59"
  ink-0: "#050d18"
  ink-1: "#0a1a2a"
  night-teal: "#0c2a3a"
  glass: "rgba(8, 20, 32, 0.62)"
  glass-strong: "rgba(7, 17, 28, 0.92)"
  line: "rgba(232, 244, 240, 0.1)"
  line-2: "rgba(232, 244, 240, 0.18)"
  ivory: "#f4f1e8"
  ivory-2: "rgba(244, 241, 232, 0.72)"
  ivory-3: "rgba(244, 241, 232, 0.5)"
  search-ink: "#2a1a00"
  glyph-ivory: "#fff8ea"
  player-red: "#e5484d"
  player-blue: "#3e63dd"
  player-amber: "#f5a524"
  player-violet: "#8e4ec6"
  player-teal: "#12a594"
  terrain-forest: "#22b865"
  terrain-desert: "#ffb23a"
  terrain-shore: "#f7e7b4"
  terrain-lake: "#33d6e4"
  terrain-mountain: "#a596e6"
  terrain-swamp: "#178a6e"
  structure-green: "#0b7a4b"
  structure-blue: "#2d6be0"
  structure-white: "#ffffff"
  territory-bear: "#0b1a2a"
  territory-cougar: "#c2185b"
  territory-edge: "#fff6e0"
  rock-top: "#3e5c7a"
  rock-base: "#101c33"
  fog: "#123344"
typography:
  display:
    fontFamily: "Unbounded, Figtree, system-ui, sans-serif"
    fontSize: "clamp(3rem, 8.2vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.035em"
  display-sub:
    fontFamily: "Unbounded, Figtree, system-ui, sans-serif"
    fontSize: "clamp(1rem, 1.6vw, 1.25rem)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.02em"
  headline:
    fontFamily: "Unbounded, Figtree, system-ui, sans-serif"
    fontSize: "clamp(2rem, 6vw, 3rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Unbounded, Figtree, system-ui, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
  clue:
    fontFamily: "Unbounded, Figtree, system-ui, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  wordmark:
    fontFamily: "Unbounded, Figtree, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
  lede:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "clamp(1.05rem, 1.4vw, 1.2rem)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  control:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  label:
    fontFamily: "Figtree, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 600
rounded:
  pill: "999px"
  lg: "20px"
  md: "14px"
  sm: "10px"
  tag: "8px"
  focus: "6px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "0.8rem"
  lg: "1rem"
  xl: "1.3rem"
  edge: "14px"
components:
  button:
    backgroundColor: "rgba(232, 244, 240, 0.06)"
    textColor: "{colors.ivory}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1.05rem"
    height: "44px"
  button-hover:
    backgroundColor: "rgba(232, 244, 240, 0.12)"
  button-primary:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.ink-0}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1.05rem"
    height: "44px"
  button-primary-hover:
    backgroundColor: "#ffffff"
  button-search:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.search-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 1.05rem"
    height: "44px"
  button-search-hover:
    backgroundColor: "#ffd57a"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ivory}"
    rounded: "{rounded.pill}"
    height: "44px"
  cta:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.ink-0}"
    rounded: "{rounded.pill}"
    padding: "0.4rem 0.45rem 0.4rem 1.6rem"
    height: "56px"
  cta-icon:
    backgroundColor: "{colors.ink-1}"
    textColor: "{colors.cyan}"
    rounded: "{rounded.pill}"
    size: "44px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ivory-2}"
    rounded: "{rounded.pill}"
    size: "40px"
  input:
    backgroundColor: "rgba(2, 8, 16, 0.45)"
    textColor: "{colors.ivory}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.85rem"
    height: "46px"
  chip:
    backgroundColor: "rgba(232, 244, 240, 0.06)"
    textColor: "{colors.ivory}"
    rounded: "{rounded.tag}"
    padding: "0.15rem 0.6rem"
  glass-panel:
    backgroundColor: "{colors.glass-strong}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.lg}"
    padding: "1rem 1.1rem"
  island-nav:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.pill}"
    padding: "6px 6px 6px 18px"
  toast:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.md}"
    padding: "0.55rem 0.6rem 0.55rem 0.8rem"
---

# Design System: Hunch

## Overview

**Creative North Star: "The Floating Island"**

A small, vivid, low-poly island hangs in a night sky, and the game is played on it. The terrain carries all the saturated colour: emerald forest, gold desert, turquoise lakes in pale shores, lavender peaks, deep blue-green swamp, set on jagged slate rock with clouds drifting below. The interface is the opposite material: translucent dark glass with hairline ivory edges, floating over the world and appearing only for the decision at hand (a nav pill at the top, a clue card bottom-left, a popover riding on the selected space).

Density is low and contextual. There is no frame, no board border and no persistent toolbar; the island fills the viewport and every action is taken on it. Three signal colours carry meaning across both layers: cyan for selection, focus and attention, gold for search and the habitat, coral for failure and closed spaces. Type pairs a wide geometric display face (Unbounded) for names, clues and moments with a friendly humanist sans (Figtree) for everything operational.

Motion is soft and settling: one expo-out curve for the interface, springs for things that move between places, and physical, slightly playful GSAP easing for pieces landing on the board. Ambient life (wind in foliage, water glints, birds, clouds, motes) runs constantly and stops under reduced motion.

**Key Characteristics:**
- Night-sky ground, colour lives in the terrain, the interface stays neutral glass.
- Three signal hues with fixed meanings: cyan, gold, coral.
- Pills and concentric rounded glass; no hard edges, no frames.
- Unbounded for display, Figtree for UI, both self-hosted.
- Drawn SVG icons and player shape glyphs, never icon fonts or emoji.
- Answers land as physical pieces with a beam and a ripple.

## Colors

A dark navy and blue-green foundation, ivory text, three bright signal hues, and a separate high-chroma world palette that only the terrain and pieces use.

### Primary
- **Lagoon Cyan** (cyan): selection and focus. The focus outline, the selected-space ring and its glow, the active player's turn ring, the hero subtitle, lobby codes, rule numbers, space links, the CTA's arrow and its glow, the "yes" verdict dot, and the beam when an answer lands.

### Secondary
- **Habitat Gold** (gold): search and the win. The search button, the habitat pillar and ring on reveal, the winner's name, the reveal title. Text on gold is Scorched Umber (search-ink), never ivory.

### Tertiary
- **Ember Coral** (coral): failure. A wrong search's expanding ring, the "no" verdict dot, closed-space chips (12% tint), the offline connection dot.

### Neutral
- **Abyss Navy** (ink-0): the deepest ground, the bottom of the page gradient, text on ivory buttons, the leaving veil.
- **Deep Harbour** (ink-1): the CTA icon disc.
- **Night Teal** (night-teal): top of the page gradient (night-teal into #0a1d2e into ink-0), lit by two soft radial glows, teal top-right and blue bottom-left.
- **Smoked Glass** (glass, 62%): floating chrome over the island: nav pill, clue card, prompt.
- **Deep Glass** (glass-strong, 92%): panels that hold reading or decisions: popover, toast, log drawer, sheets, the rules dialog.
- **Hairline** (line, line-2): ivory-tinted 1px edges. line-2 outlines every glass surface; line divides rows inside them.
- **Bone Ivory** (ivory, ivory-2, ivory-3): primary text, secondary text, and quiet meta text. Also the fill of the primary button and CTA.

### World palette
- **Terrain tiles:** each terrain blends across a ramp by low-frequency noise, so regions shift colour like real land: forest #138F55 to #9BE35A (emerald to lime glades), desert #FF6B57 to #FFD25E (coral to gold), mountain #7E86C2 to #E7A2C6 (slate, lavender, lilac, rose), swamp #0F6E66 to #2A9C70, shore #F7E7B4. Tile heights jitter per seed (mountains most), so the land steps and rolls.
- **Water:** every lake tile shares one water level. Surfaces run in rings from azure #0757C2 to the rim turquoise #33D6E4; neighbouring lakes join through edge-wide necks and corner patches into one body, with a faint #D8FBFF seam on each shared edge so every water space stays distinguishable. Lakes on the rim pour over every open edge: a lip brightening to foam #C8FAFF, then curtains a touch wider than the edge that overlap into one continuous fall.
- **Rock and air:** the island's rock fades from rock-top to rock-base; fog colour fog from 36 to 210 units.
- **Structures:** white, green and blue stones and shacks on a #fff4de plinth.
- **Territories:** a territory-edge underlay with a bear (navy, solid) or cougar (magenta, dashed) band.
- **Players:** five colours, each paired with a shape glyph (circle, triangle, square, diamond, cross) drawn in glyph-ivory.

### Named Rules
**The Three Signals Rule.** Cyan means "this, now", gold means "search, habitat, win", coral means "no". Never swap them, and never use a terrain or player colour as an interface signal.

**The Colour Belongs To The World Rule.** Interface surfaces stay navy glass and ivory. Saturated colour on screen comes from the island, the player glyphs and the three signals, nothing else.

**The Colour Plus Shape Rule.** A player is always a colour and a glyph together, in the turn strip, on pieces, in the log and on 3D decals.

## Typography

**Display Font:** Unbounded 500 and 700 (with Figtree, system-ui)
**Body Font:** Figtree 400, 400 italic, 500, 600, 700 (with system-ui)

**Character:** Unbounded is wide, rounded and confident, the voice of the game's names and the clue you are holding. Figtree is warm and plain, carrying every control and line of rules. Both are self-hosted from public/fonts under the SIL OFL with font-display swap.

### Hierarchy
- **Display** (Unbounded 700, clamp(3rem, 8.2vw, 6rem), 0.92): the home title only, with a soft dark text shadow.
- **Display sub** (Unbounded 500, clamp(1rem, 1.6vw, 1.25rem), +0.02em, cyan): the subtitle under the title.
- **Headline** (Unbounded 700, clamp(2rem, 6vw, 3rem), 1): the pass-and-play hand-off curtain.
- **Title** (Unbounded 700, 1.35rem to 1.6rem, -0.02em): reveal title, rules dialog heading; sheet and drawer headings at 1.05rem to 1.3rem.
- **Clue** (Unbounded 500, 1.08rem, 1.35): the player's private clue, the one sentence that matters most in play.
- **Wordmark and codes** (Unbounded 700, 0.85rem to 0.95rem): the nav wordmark, the space code tag (for example "F1"), rule numerals.
- **Lede** (Figtree 400, clamp(1.05rem, 1.4vw, 1.2rem), 1.55): two lines of story on home, max 32rem.
- **Body** (Figtree 400, 15px, 1.45, tabular numerals): all running text; rules paragraphs cap at 62ch.
- **Control** (Figtree 600): buttons, turn names, prompts; the CTA at 1.02rem.
- **Label** (Figtree 600, 0.8rem to 0.85rem, ivory-2 or ivory-3): field labels and the small action group labels in the popover. Sentence case, no tracking.

### Named Rules
**The Display Is For Words That Matter Rule.** Unbounded sets names, headings, the clue and codes. Anything you operate (buttons, labels, lists, toasts) is Figtree.

**The Tabular Rule.** Numerals are tabular everywhere, so coordinates and counts never jitter.

## Layout

Full-bleed and layered. The 3D island fills the viewport (100dvh, overflow hidden) and the interface floats over it at a 14px edge inset.

- **Home:** the island is set to the right; a left-to-right navy vignette makes room for the hero block at bottom-left (left clamp(1.25rem, 6vw, 6rem), bottom clamp(2rem, 10vh, 7rem), max 34rem, 1.4rem gaps). Setup sheets slide in on the right, centred vertically, max 25rem wide.
- **Game:** a glass nav pill at top centre (14px from the top); bottom HUD row with the clue card (max 21rem) left and a one-line prompt centred; the toast sits right; the log drawer docks right (max 23rem) between 84px from the top and 96px from the bottom.
- **Popover:** anchored to the selected space each frame, 22rem wide with an 18px gap and a 14px rotated tail; it flips below near the top edge and shifts its tail to 14% or 86% near the side edges.
- **Spacing rhythm:** small rem steps (xs 0.35rem, sm 0.6rem, md 0.8rem, lg 1rem, xl 1.3rem) inside panels; 2px gaps between pills in the nav.
- **Breakpoints:** at 860px the nav spans the width, drops the wordmark and room name, and shows only the active player's name. At 700px the hero spans the width with a bottom-up vignette, sheets become bottom sheets, the HUD stacks (toast first), the log drawer becomes a full-width overlay, and the popover docks to the bottom of the screen.
- **Touch:** controls are at least 44px tall (icon buttons 40px, small 32px).

## Elevation & Depth

Depth comes from three places: the real 3D scene (lighting, fog, tile heights, clouds below), translucency (backdrop blur 16px on chrome, 18px on panels, 22px on the rules dialog) and one soft lift shadow shared by every floating surface. Nothing uses a hard or offset shadow.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 24px 60px -24px rgba(2, 8, 16, 0.75)`): every glass surface. The inset top hairline reads as a lit glass edge.
- **Cyan glow** (`box-shadow: 0 18px 40px -16px rgba(92, 225, 230, 0.55)`, hover `0 22px 50px -14px rgba(92, 225, 230, 0.7)`): the CTA only.
- **Turn ring** (`box-shadow: inset 0 0 0 1px rgba(92, 225, 230, 0.55)` on a 14% cyan fill): the active player.
- **Your-turn ring** (`box-shadow: <lift>, 0 0 0 1px rgba(92, 225, 230, 0.4)`): the prompt when it is your move.
- **Text halo** (`text-shadow: 0 2px 18px rgba(5, 13, 24, 0.9)`): text set directly over the island on home.

### The 3D world
- **Light:** hemisphere #d6ecff over #1e5a5a (1.25), warm sun #ffd7a0 (3.2) with shadows, cool fill #8fc8ff (0.6), Neutral tone mapping at exposure 1.08 to keep hues saturated.
- **Tiles:** beveled hex platforms (bevel 0.05, flat shaded) at terrain heights water 0.22, swamp 0.3, desert 0.36, forest 0.42, mountain 0.6; jagged rock columns beneath, deepest in the middle.
- **Props:** instanced and seeded: emerald and lime pines, broadleaf trees, bushes, grass, flowers, snow-capped peaks, boulders, mesas, shards, cacti, reeds, pools, lilies, mangroves, jetties, ruins. Foliage sways per instance; cloud shadows drift over everything.
- **Ambient life:** birds on curved loops that land on treetops and peaks, fireflies over swamp and forest, rising rings on lakes, twinkling stars below, soft sprite clouds. Home adds floating islets and a slow perspective camera.
- **Feedback:** hover is a pale #cffbff additive band and a 20% brighter tile; selection is a navy hairline, a cyan band, a breathing cyan glow and a short column of light. Spaces your clue rules out sit under a pale drifting mist (55% toward #A3B5CC, in the shared world shader), which keeps a hint of terrain hue and never turns grey or brown; live spaces stay fully saturated by contrast.
- **Structures:** standing stones (eight-sided) and huts (walls, overhanging gabled roof a shade darker, door, chimney) on an ivory plinth.

### Named Rules
**The One Lift Rule.** Every floating surface gets the same lift shadow. Hierarchy comes from glass opacity (62% versus 92%) and blur, not from bigger shadows.

## Shapes

Soft and concentric. Anything you press is a full pill (999px): buttons, the CTA and its icon disc, the nav, turn chips, the prompt, the segmented control. Containers step down from 20px (panels, clue card, drawer) to 14px (toast, lobby seats) to 10px (inputs) to 8px (tags, chips, space links). Focus outlines round at 6px. Edges are 1px hairlines. In the world, everything is a hexagon: tiles, selection rings, ripples, territory bands, the cube marker silhouette.

## Components

### Buttons
Tactile glass pills that press in.
- **Shape:** full pill (999px), min height 44px, padding 0.5rem 1.05rem, Figtree 600.
- **Default:** 6% ivory wash with a line-2 hairline; hover 12% wash and a 30% edge.
- **Primary:** ivory fill, abyss text; hover pure white. Used for the decisive action in a panel (place a cube, play again, start).
- **Search:** gold fill, umber text; hover #ffd57a. Only for searching a space.
- **Ghost:** transparent with the hairline, for cancel.
- **Press and disabled:** scale 0.97 on press; disabled at 38% opacity with a not-allowed cursor. Transitions 0.3s on the house ease.
- **Ask a player:** the default pill with the player's glyph inset (padding 0.35rem 0.85rem 0.35rem 0.4rem, 40px tall).

### Call to action
The one dominant pill on home: ivory, 56px tall, label left and a 44px ink disc on the right holding a cyan arrow. A cyan under-glow lifts it; on hover the glow grows and the disc nudges 3px right and scales 1.05; press scales 0.98. Transitions 0.5s.

### Icon buttons and text links
- **Icon button:** 40px (small 32px) transparent circle, ivory-2 icon, 10% wash and ivory on hover.
- **Text button:** ivory-2, underlined at 5px offset in 30% ivory; hover ivory with a cyan underline.
- **Coordinate link:** tabular, ivory-2, hover cyan with an underline.

### Glass panels
- **Corner:** 20px. **Background:** glass-strong. **Edge:** line-2. **Shadow:** lift. **Padding:** 1rem 1.1rem (1.3rem in sheets), 0.8rem gaps, 18px blur.
- Rows inside panels divide with a line hairline; the popover's action group sits above a line top border.

### Inputs
- **Style:** 46px tall, 10px radius, line-2 hairline, 45% abyss fill, ivory text, ivory-3 placeholder.
- **Focus:** no outline ring; the border turns cyan and the fill deepens to 65%.
- **Room code:** uppercase, 0.3em tracking, 700, centred.

### Chips and tags
- **Chip:** 8px radius, 6% ivory wash, 0.82rem. Closed spaces use a 12% coral wash.
- **Space code:** Unbounded 700 0.85rem in an 8px tag with a 10% wash.
- **Verdict:** 0.85rem 600 text led by an 8px dot: cyan for yes, coral for no.

### Navigation
The island nav is one glass pill at top centre: the Unbounded wordmark, the turn strip, then 40px icon buttons. Turn chips are pills with a glyph; inactive names are ivory-3, the active one ivory inside a cyan ring that glides between players on a spring. The winner turns gold. Offline glyphs drop to 40%.

### Segmented control
A 4px-padded pill track (50% abyss fill, line hairline) with two 40px options; the selected option sits on an ivory pill that slides between them on a spring (stiffness 400, damping 34) and turns its label abyss.

### Space popover (signature)
A glass panel that rides on the selected space with a rotated tail. Head: space code tag, terrain icon, terrain name, close. Then features, pieces already placed, a verdict line, and the actions: "Ask a player" pills and the gold search button. It fades and rises 0.3s on the house ease. On phones it docks to the bottom edge.

### Toast and prompt
- **Toast:** glass-strong, 14px radius, 0.92rem, enters with a 0.45s rise and blur-in; holds a space link (8px tag, cyan bold text).
- **Prompt:** a glass pill, 600 0.95rem ivory-2; ivory with a 40% cyan ring when it is your turn.

### Public hunt
- **Home entry:** a glass pill beside the CTA, led by a live dot (green with a ping when anyone is hunting) and the live count in ivory-2.
- **Rule picker:** stacked rows (name, live status, one-line pitch) in a 14px container; the chosen row wears a cyan ring that glides between rows on the house spring.
- **Briefing:** a centred deep-glass card over a soft navy radial dim: two blinking gold eyes, the creature's name in Unbounded (clamp 1.8 to 2.6rem), its epithet in gold Unbounded 500, the field report in italic ivory-2, three rule lines, then the hunter count and a countdown whose digits roll.
- **Case file:** smoked glass bottom-left (max 23rem). Clues are Unbounded 500 rows behind numbered discs; the lensed clue gets a 10% cyan wash, a cyan edge and a cyan disc. The next slot is a dashed disc with a draining cyan hairline.
- **Clue drop:** a deep-glass banner under the nav with a cyan disc and a faint cyan halo; it blurs in, then morphs into its case-file row (shared layout, house spring).
- **Guess:** the popover's gold button; during a cooldown it dims and a gold wash drains across it.
- **Miss toast:** the standard toast with a coral inner edge, a coral "Not F4." and a five-tick ivory heat meter. Temperature is told by words and tick count, never by new colours.
- **Reveal panel:** deep glass docked right (bottom sheet on phones) so the gold pillar stays visible: gold title, three stat tiles that count up, the clue list with spaces left after each and a board replay, and a flat crowd heat map (ivory density over muted terrain, the answer ringed in gold, your guesses as coral dots).

### Icons
Drawn for this game, 24px viewBox at 18px: interface icons are 1.5px strokes with round caps and joins (log, book, lens, eye, exit, target, pencil, close, arrow, ask). Terrain icons are filled silhouettes in a bright tint per terrain (swamp is stroked); structure and territory icons repeat their 3D forms.

### Board feedback (3D)
- **Select:** ring pops from 1.3x to 1x in 0.4s (expo.out).
- **Answer lands:** piece drops 2.6 units with bounce.out (0.6s), squashes back with back.out(3) (0.35s), a cyan beam rises (0.35s) and fades (0.7s), a pale ripple expands to 1.35x (0.7s).
- **Failed search:** a coral hex ring expands to 2.6x and fades over 0.9s; the piece wobbles with elastic.out.
- **Habitat reveal:** a gold pillar grows and a gold ring closes in (1.1s, expo.out) with sparks, the sun warms over 1.5s, and the camera glides and zooms to 1.6 over 1.4s (power3.inOut).

## Do's and Don'ts

### Do:
- **Do** use the house ease cubic-bezier(0.22, 1, 0.36, 1) for interface motion, cubic-bezier(0.32, 0.72, 0, 1) for side sheets and drawers, and a spring (stiffness 380, damping 30) for things that move between places.
- **Do** keep interface surfaces as navy glass with a 1px line-2 hairline and the lift shadow.
- **Do** pair every player colour with its shape glyph.
- **Do** give every control a 44px target where space allows, and a 2px cyan focus outline at 3px offset.
- **Do** draw new icons as 1.5px round-capped strokes on a 24px grid.
- **Do** honour reduced motion: CSS transitions collapse and 3D effects skip their animation.

### Don't:
- **Don't** bring back brown parchment, wooden frames, beige panels or muted colour; the product retired that look.
- **Don't** add a persistent action toolbar or frame panels around the board; actions belong in the popover on the selected space.
- **Don't** use cyan, gold or coral for anything outside their meanings, or a terrain colour as an interface accent.
- **Don't** use hard or offset shadows; depth is the scene, the glass and the one lift.
- **Don't** use emoji, icon fonts or stock icon sets.
- **Don't** set controls, labels or lists in Unbounded.
