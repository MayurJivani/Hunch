---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

Scope: the game screen (board, players, clue, history, actions), plus the home and lobby screens that lead into it. Mode: Operate.

Audience and job: 3 to 5 players taking turns; each turn they pick a space, then question someone or search. Frequent actions: select space, question, search, place a penalty cube, read the last answer. Constraints: private clue hidden on shared devices; board readable at phone width.

## Direction contract

THESIS: A small living world you play on. The island is the interface and the interface floats over it in glass, appearing only for the decision at hand. Refuses the category default of a dashboard of panels around an embedded 3D map.

OWN-WORLD: Night-sky ground (midnight navy into blue-green). A floating low-poly island of raised beveled hex tiles over jagged slate rock: emerald and lime forest with pines and flowers, turquoise-to-azure lakes inside pale shores with drifting glints and rim waterfalls, coral and gold desert with orange shards and cacti, lavender and lilac peaks, deep blue-green swamp with glowing pools and cattails. Ivory birds, drifting clouds below the island, warm motes. Interface: translucent dark glass with hairline edges, ivory text, cyan for selection and focus, gold for search and the habitat, coral for failure. Unbounded for display, Figtree for everything else, custom fine-line icons.

STORY: The visitor arrives on a living island, understands it is a deduction game for 3 to 5 people, and begins. In play they pick a space on the board, ask a player or search from a popover on that space, and watch the answer drop onto the map with a short toast.

FIRST VIEWPORT: Home: full-bleed animated island, set right; bottom-left the title (Unbounded, ~6rem), the cyan subtitle, two lines of story, one dominant ivory "Begin the hunt" pill with its arrow in a disc, a quiet "How to play" link, one meta line. Game: the island fills the screen; a floating glass nav pill at the top centre holds the wordmark, the turn strip (active player ringed in cyan) and icon buttons; bottom-left the clue card; bottom-centre a one-line prompt; the action popover rides on the selected space.

FORM: Brief-pinned direction. The user's rehaul brief pins the world, quoted: "Create a vibrant, stylized wilderness with a premium low-poly art direction inspired by modern indie exploration and strategy games." and "Use dark navy, deep forest green, or atmospheric blue-green as the primary interface foundation." No concept roll ran; the pinned direction overrides it. seed: none (brief-pinned). Signature move: the contextual popover that rides on the selected space, plus answers that land as pieces with a light beam and ripple.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
