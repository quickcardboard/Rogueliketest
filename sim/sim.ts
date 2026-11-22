/**
 * Headless balance simulation: plays N seeded runs with the heuristic bot
 * and reports outcomes.  Usage: npm run sim -- [runs] [startSeed]
 */
import { newGame, people } from '../src/core/game';
import { botTurn } from './bot';

const runs = Number(process.argv[2] ?? 200);
const start = Number(process.argv[3] ?? 1);

let won = 0;
let lost = 0;
let stalled = 0;
const days: number[] = [];
const assaults: number[] = [];
const reasons: Record<string, number> = {};

for (let seed = start; seed < start + runs; seed++) {
  const s = newGame(seed);
  let steps = 0;
  while (s.outcome === 'playing' && steps++ < 2000 && s.day < 80) botTurn(s);
  if (s.outcome === 'won') won++;
  else if (s.outcome === 'lost') {
    lost++;
    const r = s.outcomeText.includes('keep') ? 'keep fell' : s.outcomeText.includes('heart') ? 'heart arrived' : 'no people';
    reasons[r] = (reasons[r] ?? 0) + 1;
  } else stalled++;
  days.push(s.day);
  assaults.push(s.assaults);
  if (runs <= 5) console.log(`seed ${seed}: ${s.outcome} day ${s.day}, people ${people(s)}, supplies ${s.supplies}, assaults ${s.assaults}`);
}

const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(`runs ${runs}: won ${won} (${((won / runs) * 100).toFixed(0)}%), lost ${lost}, stalled ${stalled}`);
console.log(`avg day ${avg(days)}, avg assaults ${avg(assaults)}`);
console.log('loss reasons', reasons);
