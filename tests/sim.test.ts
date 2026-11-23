import { describe, expect, it } from 'vitest';
import { laborCounts, newGame, queueProject, setLabor, step } from '../src/core/sim';
import { playOut } from '../sim/bot';

const runHours = (s: ReturnType<typeof newGame>, h: number) => {
  for (let i = 0; i < h * 20 && s.outcome === 'playing'; i++) {
    if (s.event) s.event = null;
    s.alert = null;
    step(s);
  }
};

describe('simulation', () => {
  it('is deterministic for a seed', () => {
    const a = playOut(newGame(11), 20);
    const b = playOut(newGame(11), 20);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it('assigns labor according to the sliders', () => {
    const s = newGame(4);
    for (const l of ['gather', 'build', 'scout', 'hunt'] as const) setLabor(s, l, 0);
    setLabor(s, 'guard', 100);
    runHours(s, 1);
    expect(laborCounts(s).guard).toBe(s.colonists.length);
  });

  it('builders finish a queued project', () => {
    const s = newGame(5);
    s.supplies = 200;
    expect(queueProject(s, { kind: 'inner', building: 'granary' })).toBeNull();
    setLabor(s, 'build', 100);
    runHours(s, 20);
    expect(s.settlement.inner.granary).toBe(true);
  });

  it('scouting reveals the wilds', () => {
    const s = newGame(6);
    const before = s.fogSeen.filter((x) => x >= 0).length;
    runHours(s, 12);
    expect(s.fogSeen.filter((x) => x >= 0).length).toBeGreaterThan(before * 2);
  });

  it('bot runs always end', () => {
    for (let seed = 1; seed <= 6; seed++) expect(playOut(newGame(seed), 60).outcome).not.toBe('playing');
  }, 60000);
});
