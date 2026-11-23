import { describe, expect, it } from 'vitest';
import { jobCounts, newGame, queueProject, setSplit, step } from '../src/core/sim';
import { playOut } from '../sim/bot';

const runHours = (s: ReturnType<typeof newGame>, h: number) => {
  for (let i = 0; i < h * 20 && s.outcome === 'playing'; i++) {
    if (s.event) s.event = null;
    if (s.boon) s.boon = null;
    s.alert = null;
    step(s);
  }
};

describe('simulation', () => {
  it('is deterministic for a seed', () => {
    const a = playOut(newGame(11), 20);
    const b = playOut(newGame(11), 20);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  }, 60000);

  it('keeps soldiers and workers in separate pools', () => {
    const s = newGame(4);
    s.directives.hunt = false;
    setSplit(s, 'scout', 0);
    setSplit(s, 'build', 0);
    runHours(s, 1);
    const soldiers = s.colonists.filter((c) => c.role === 'militia' || c.role === 'archer' || c.role === 'scout');
    expect(soldiers.every((c) => c.labor === 'drill')).toBe(true);
    expect(s.colonists.filter((c) => c.labor === 'drill').length).toBe(soldiers.length);
    expect(jobCounts(s).scout).toBe(0);
  });

  it('the bell brings everyone to the walls', () => {
    const s = newGame(8);
    runHours(s, 6);
    s.bell = true;
    runHours(s, 8);
    expect(s.colonists.filter((c) => c.task !== 'wounded').every((c) => Math.hypot(c.x, c.y) < 15)).toBe(true);
  });

  it('offers a choice at the end of the day', () => {
    const s = newGame(9);
    while (!s.boon && s.time < 30) {
      s.alert = null;
      if (s.event) s.event = null;
      step(s);
    }
    expect(s.boon?.length).toBe(3);
  });

  it('builders finish a queued project', () => {
    const s = newGame(5);
    s.supplies = 200;
    expect(queueProject(s, { plot: 'granary' })).toBeNull();
    setSplit(s, 'build', 100);
    runHours(s, 20);
    expect(s.plots.find((p) => p.key === 'granary')!.level).toBe(1);
  });

  it('rings turn at midnight and change warbands that cross them', () => {
    const s = newGame(12);
    const before = s.rings.map((r) => r.offset);
    runHours(s, 20);
    expect(s.rings.map((r) => r.offset)).not.toEqual(before);
  });

  it('night stalkers appear after dark and fade at dawn', () => {
    const s = newGame(13);
    let seen = 0;
    for (let i = 0; i < 24 * 20 && s.outcome === 'playing'; i++) {
      if (s.event) s.event = null;
      if (s.boon) s.boon = null;
      s.alert = null;
      step(s);
      seen = Math.max(seen, s.horde.filter((u) => u.mode === 'stalk').length);
    }
    expect(seen).toBeGreaterThan(0);
    expect(s.horde.filter((u) => u.mode === 'stalk').length).toBe(0);
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
