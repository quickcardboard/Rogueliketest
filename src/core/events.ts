import { MAX_EQUIPMENT, MAX_SQUAD, SPECIAL_INFO } from './data';
import { chance, int, pick } from './rng';
import type { GameState, PendingEvent, SpecialId } from './types';
import { reveal } from './world';
import { addLog, addSquad, grantSpecial } from './state';

interface EventDef {
  make(s: GameState): PendingEvent;
  resolve(s: GameState, option: number): void;
}

function availableSpecial(s: GameState): SpecialId | null {
  const all = Object.keys(SPECIAL_INFO) as SpecialId[];
  const left = all.filter((x) => !s.specials.includes(x));
  return left.length ? pick(s.rng, left) : null;
}

function hurtRandom(s: GameState, n: number, wound: boolean) {
  for (let i = 0; i < n; i++) {
    const pool = s.squads.filter((q) => q.health > 0 && q.assignment.type !== 'expedition');
    if (!pool.length) return;
    const q = pick(s.rng, pool);
    q.health--;
    if (wound) q.wounded++;
  }
}

export const EVENTS: Record<string, EventDef> = {
  wanderer: {
    make: () => ({
      id: 'wanderer',
      title: 'A Wanderer at the Gate',
      text: 'A thin figure with a lantern asks for shelter. They say they have walked from a village that is no longer there.',
      options: [
        { label: 'Welcome them', hint: '+1 person, −3 supplies' },
        { label: 'Give bread and send them on', hint: '−1 supply' },
      ],
    }),
    resolve(s, o) {
      if (o === 0) {
        s.supplies = Math.max(0, s.supplies - 3);
        const q = s.squads.find((x) => x.health + x.wounded < MAX_SQUAD && x.assignment.type !== 'expedition');
        if (q) q.health++;
        else addSquad(s, 'militia', 1);
        addLog(s, 'The wanderer stays. Their lantern hangs by the gate now.', 'good');
      } else {
        s.supplies = Math.max(0, s.supplies - 1);
        addLog(s, 'The wanderer thanks you and walks on into the grey.');
      }
    },
  },
  cellar: {
    make: () => ({
      id: 'cellar',
      title: 'A Sealed Cellar',
      text: 'Roots have cracked open a stone cellar. Something rustles in the dark below, or perhaps it is only wind.',
      options: [
        { label: 'Open it', hint: '60%: +15 supplies · 40%: someone is hurt' },
        { label: 'Leave it sealed', hint: 'Nothing happens' },
      ],
    }),
    resolve(s, o) {
      if (o !== 0) return addLog(s, 'You leave the cellar to its silence.');
      if (chance(s.rng, 0.6)) {
        s.supplies += 15;
        addLog(s, 'Jars of preserved fruit, still sweet. +15 supplies.', 'good');
      } else {
        hurtRandom(s, 1, true);
        addLog(s, 'Something small and many-legged pours out. One of ours is hurt.', 'bad');
      }
    },
  },
  shrine: {
    make: () => ({
      id: 'shrine',
      title: 'The Harvest Shrine',
      text: 'An old shrine to a forgotten harvest god, its offering bowl still polished by someone.',
      options: [
        { label: 'Leave an offering', hint: '−5 supplies · a gift may follow' },
        { label: 'Take its stones for the walls', hint: '+12 supplies · the wilds grow restless' },
      ],
    }),
    resolve(s, o) {
      if (o === 0) {
        s.supplies = Math.max(0, s.supplies - 5);
        const sp = availableSpecial(s);
        if (sp && chance(s.rng, 0.7)) grantSpecial(s, sp);
        else {
          s.supplies += 10;
          addLog(s, 'When you return, the bowl is full of seed grain. +10 supplies.', 'good');
        }
      } else {
        s.supplies += 12;
        s.threat += 3;
        addLog(s, 'The stones are good stones. Something in the wilds takes notice.', 'bad');
      }
    },
  },
  fever: {
    make: () => ({
      id: 'fever',
      title: 'Fever',
      text: 'A fever is spreading through the bunkhouses. The herbalist says it can be stopped, at a price.',
      options: [
        { label: 'Buy medicine', hint: '−8 supplies' },
        { label: 'Let it run its course', hint: '2 people fall ill (wounded)' },
      ],
    }),
    resolve(s, o) {
      if (o === 0 && s.supplies >= 8) {
        s.supplies -= 8;
        addLog(s, 'The fever breaks within a day.', 'good');
      } else {
        hurtRandom(s, 2, true);
        addLog(s, 'The fever takes its time. Two lie abed.', 'bad');
      }
    },
  },
  merchant: {
    make: (s) => ({
      id: 'merchant',
      title: 'A Lost Merchant',
      text: 'A merchant wagon has wandered off every road that still exists. Its driver will trade for food.',
      options: [
        { label: 'Buy tools and arms', hint: s.settlement.equipment < MAX_EQUIPMENT ? '−10 supplies · equipment +1' : 'Already fully equipped' },
        { label: 'Buy a curiosity', hint: '−18 supplies · a special item' },
        { label: 'Decline', hint: 'Nothing happens' },
      ],
    }),
    resolve(s, o) {
      if (o === 0 && s.supplies >= 10 && s.settlement.equipment < MAX_EQUIPMENT) {
        s.supplies -= 10;
        s.settlement.equipment++;
        addLog(s, 'Good steel, a little rusted. Equipment improved.', 'good');
      } else if (o === 1 && s.supplies >= 18) {
        const sp = availableSpecial(s);
        if (!sp) return addLog(s, 'The merchant has nothing left you have not already seen.');
        s.supplies -= 18;
        grantSpecial(s, sp);
      } else addLog(s, 'The merchant rolls on, looking for a road.');
    },
  },
  echo: {
    make: () => ({
      id: 'echo',
      title: 'The Hum Beneath',
      text: 'The ground here hums. If you press an ear to it, you can almost hear where the heart of the blight is beating.',
      options: [
        { label: 'Listen', hint: 'Reveals the source · the wilds grow restless' },
        { label: 'Cover it with earth', hint: 'Nothing happens' },
      ],
    }),
    resolve(s, o) {
      if (o === 0) {
        reveal(s, s.source);
        s.threat += 4;
        addLog(s, 'You hear it, slow and enormous. Its location is marked on the map.', 'info');
      } else addLog(s, 'You bury the sound. It does not bury easily.');
    },
  },
};

const STRANGE_EVENTS = ['cellar', 'shrine', 'echo', 'merchant'];
const DAILY_EVENTS = ['wanderer', 'fever', 'merchant'];

export function triggerEvent(s: GameState, id: string) {
  s.event = EVENTS[id]!.make(s);
}

export function strangeEvent(s: GameState) {
  triggerEvent(s, pick(s.rng, STRANGE_EVENTS));
}

export function maybeDailyEvent(s: GameState) {
  if (!s.event && chance(s.rng, 0.1)) triggerEvent(s, DAILY_EVENTS[int(s.rng, 0, DAILY_EVENTS.length - 1)]!);
}

export function resolveEvent(s: GameState, option: number) {
  if (!s.event) return;
  const id = s.event.id;
  s.event = null;
  EVENTS[id]!.resolve(s, option);
}
