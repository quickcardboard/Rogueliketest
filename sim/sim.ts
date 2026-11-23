/** Headless balance run. Usage: npm run sim -- [runs] [startSeed] */
import { newGame } from '../src/core/sim';
import { playOut } from './bot';

const runs = Number(process.argv[2] ?? 50);
const start = Number(process.argv[3] ?? 1);
const tally: Record<string, number> = {};
const days: number[] = [];
const assaults: number[] = [];
const pops: number[] = [];
const t0 = Date.now();
for (let seed = start; seed < start + runs; seed++) {
  const s = playOut(newGame(seed));
  const why = s.outcome === 'won' ? 'won' : s.outcome === 'playing' ? 'timeout' : /keep/.test(s.outcomeText) ? 'keep fell' : /heart/.test(s.outcomeText) ? 'heart arrived' : 'no people';
  tally[why] = (tally[why] ?? 0) + 1;
  days.push(s.time / 24);
  assaults.push(s.assaults);
  pops.push(s.colonists.length);
  if (runs <= 5) console.log(`seed ${seed}: ${why} day ${(s.time / 24).toFixed(1)} pop ${s.colonists.length} supplies ${Math.round(s.supplies)} assaults ${s.assaults} wall ${s.settlement.wallLevel} heart ${s.heart.strength.toFixed(1)}`);
}
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(`${runs} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s`, tally);
console.log(`avg day ${avg(days)}, assaults ${avg(assaults)}, final pop ${avg(pops)}`);
