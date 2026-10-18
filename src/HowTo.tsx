import { useEffect, useRef } from 'react';
import { TERRAINS } from '../shared/board.ts';
import { Icon, StructureIcon, TerrainIcon, TerritoryIcon } from './pieces.tsx';

const STEPS: [string, string][] = [
  ['A creature lives on exactly one space', 'The island has five terrains, bear and cougar territories, and six structures: a standing stone and an abandoned shack in white, green and blue.'],
  ['You each hold one clue', 'Your clue is one true fact about the habitat, like "within one space of water". Every clue is different. Together they point to a single space, and nobody can find it alone.'],
  ['Open with two cubes', 'In turn order, everyone places two cubes on spaces their own clue rules out. A cube means "not here".'],
  ['On your turn, question someone', 'Pick a space and another player. Their clue answers for them: a disc means it could be there, a cube means it cannot. If you get a cube, you place one of your own cubes too, which gives away a little about your clue.'],
  ['Or search, when you are sure', 'Pick a space your clue allows. Everyone else answers in turn. If they all place discs, you win. The first cube ends the search and you owe a cube.'],
  ['Read the pieces', 'A space with a cube is closed for good. Every disc and cube tells you something about that player\'s clue. Work out theirs before they work out yours.'],
];

export function HowTo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="howto" onClose={onClose} aria-labelledby="howto-title">
      <header>
        <h2 id="howto-title">How to play</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </header>
      <ol className="rules">
        {STEPS.map(([h, p]) => <li key={h}><h3>{h}</h3><p>{p}</p></li>)}
      </ol>
      <h3 className="sub">Kinds of clue</h3>
      <ul className="clue-kinds">
        <li>On one of two terrains</li>
        <li>Within one space of a terrain</li>
        <li>Within one space of either animal territory</li>
        <li>Within two spaces of a standing stone, a shack, bear or cougar territory</li>
        <li>Within three spaces of a white, green or blue structure</li>
      </ul>
      <p className="dim">"Within" counts the space itself: a forest space is within one space of forest.</p>
      <h3 className="sub">Hard mode</h3>
      <p className="dim">Black standing stones and shacks join the map (eight structures in all), black joins the colour clues, and some clues are negative: "the habitat is <em className="not">not</em> within two spaces of bear territory". A "not" clue allows exactly the spaces its positive form rules out. Every hard game deals at least one "not" clue.</p>
      <h3 className="sub">The notebook</h3>
      <p className="dim">The field log button also opens a notebook. It lists, for each player, the clues their pieces still fit, and can fade every space the table has already ruled out. It only reads pieces on the board, the same as keeping notes with pen and paper.</p>
      <h3 className="sub">Map key</h3>
      <ul className="key">
        {TERRAINS.map((t) => <li key={t}><TerrainIcon t={t} /> {t[0].toUpperCase() + t.slice(1)}</li>)}
        <li><TerritoryIcon animal="bear" /> Bear territory, solid band</li>
        <li><TerritoryIcon animal="cougar" /> Cougar territory, dashed band</li>
        <li><StructureIcon kind="stone" color="white" /> Standing stone, tall and eight-sided</li>
        <li><StructureIcon kind="shack" color="white" /> Abandoned shack, pitched roof</li>
        <li><StructureIcon kind="stone" color="black" /> Black structures appear in hard mode only</li>
      </ul>
    </dialog>
  );
}
