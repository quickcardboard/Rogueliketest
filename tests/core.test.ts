import { describe, expect, it } from 'vitest';
import { advanceDay, assaultEstimate, newGame, queueProject, sendExpedition } from '../src/core/game';
import { botTurn } from '../sim/bot';
import { dist, key } from '../src/core/world';

function playOut(seed: number) {
  const s = newGame(seed);
  while (s.outcome === 'playing' && s.day < 80) botTurn(s);
  return s;
}

describe('core', () => {
  it('is deterministic for a given seed', () => {
    const a = playOut(42);
    const b = playOut(42);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('starts with the source on the edge of the wilds', () => {
    const s = newGame(7);
    expect(dist(s.source)).toBe(4);
    expect(s.squads.length).toBe(5);
  });

  it('queues and completes a project with workers', () => {
    const s = newGame(3);
    expect(queueProject(s, { kind: 'inner', building: 'granary' })).toBeNull();
    for (const q of s.squads) q.assignment = { type: 'work' };
    for (let i = 0; i < 3 && !s.battle && !s.event; i++) advanceDay(s);
    expect(s.settlement.inner.granary).toBe(true);
  });

  it('scouting refreshes intel', () => {
    const s = newGame(5);
    const scout = s.squads.find((q) => q.role === 'scout')!;
    const target = { x: 2, y: 0 };
    expect(sendExpedition(s, [scout.id], target, 'scout')).toBeNull();
    advanceDay(s);
    const i = s.intel[key(target)];
    expect(i).toBeDefined();
    expect(i!.uncertain).toBe(false);
  });

  it('assault estimate gives a sensible range', () => {
    const s = newGame(9);
    const e = assaultEstimate(s);
    expect(e.minDays).toBeLessThanOrEqual(e.maxDays);
  });

  it('every bot run ends', () => {
    for (let seed = 1; seed <= 30; seed++) expect(playOut(seed).outcome).not.toBe('playing');
  });
});
