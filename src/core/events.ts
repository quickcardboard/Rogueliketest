import { MAX_EQUIPMENT } from './data';
import { chance, pick } from './rng';
import { addLog, grantRandomSpecial, spawnColonist } from './state';
import type { Colonist, GameState, PendingEvent } from './types';
import { sectorName } from './world';

interface EventDef {
  make(s: GameState): PendingEvent;
  resolve(s: GameState, option: number): void;
}

function hurtSomeone(s: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    const pool = s.colonists.filter((c) => c.task !== 'wounded' && c.hp > 0);
    if (!pool.length) return;
    const c = pick(s.rng, pool);
    c.task = 'wounded';
    c.phase = 'walk';
    c.labor = null;
    c.timer = 36;
    c.hp = 1;
  }
}

export const EVENTS: Record<string, EventDef> = {
  wanderer: {
    make: () => ({
      id: 'wanderer',
      title: 'A Wanderer at the Gate',
      text: 'A thin figure with a lantern asks for shelter. They walked here from a village that is no longer there.',
      options: [
        { label: 'Welcome them', hint: '+1 villager' },
        { label: 'Give bread and send them on', hint: '−3 supplies' },
      ],
    }),
    resolve(s, o) {
      if (o === 0) {
        spawnColonist(s, 'villager');
        s.stats.born++;
        addLog(s, 'The wanderer stays. Their lantern hangs by the gate now.', 'good');
      } else {
        s.supplies = Math.max(0, s.supplies - 3);
        addLog(s, 'The wanderer thanks you and walks on into the grey.');
      }
    },
  },
  cellar: {
    make: () => ({
      id: 'cellar',
      title: 'A Sealed Cellar',
      text: 'A scout has found a stone cellar cracked open by roots. Something rustles below, or perhaps it is only the wind.',
      options: [
        { label: 'Open it', hint: '60%: +25 supplies · 40%: someone is hurt' },
        { label: 'Leave it sealed', hint: 'Nothing happens' },
      ],
    }),
    resolve(s, o) {
      if (o !== 0) return addLog(s, 'You leave the cellar to its silence.');
      if (chance(s.rng, 0.6)) {
        s.supplies += 25;
        addLog(s, 'Jars of preserved fruit, still sweet. +25 supplies.', 'good');
      } else {
        hurtSomeone(s, 1);
        addLog(s, 'Something many-legged pours out of the dark. One of ours is hurt.', 'bad');
      }
    },
  },
  shrine: {
    make: () => ({
      id: 'shrine',
      title: 'The Harvest Shrine',
      text: 'An old shrine to a forgotten harvest god, its offering bowl still polished by someone.',
      options: [
        { label: 'Leave an offering', hint: '−8 supplies · a gift may follow' },
        { label: 'Take its stones for the walls', hint: '+20 supplies · the wilds grow restless' },
      ],
    }),
    resolve(s, o) {
      if (o === 0) {
        s.supplies = Math.max(0, s.supplies - 8);
        if (!(chance(s.rng, 0.7) && grantRandomSpecial(s, 'In the offering bowl, the next morning: '))) {
          s.supplies += 18;
          addLog(s, 'The bowl is full of seed grain the next morning. +18 supplies.', 'good');
        }
      } else {
        s.supplies += 20;
        s.threat += 8;
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
        { label: 'Buy medicine', hint: '−12 supplies' },
        { label: 'Let it run its course', hint: 'Two people fall ill for a day and a half' },
      ],
    }),
    resolve(s, o) {
      if (o === 0 && s.supplies >= 12) {
        s.supplies -= 12;
        addLog(s, 'The fever breaks within a day.', 'good');
      } else {
        hurtSomeone(s, 2);
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
        { label: 'Buy tools and arms', hint: s.settlement.equipment < MAX_EQUIPMENT ? '−20 supplies · equipment +1' : 'Already fully equipped' },
        { label: 'Buy a curiosity', hint: '−30 supplies · a special item' },
        { label: 'Decline', hint: 'Nothing happens' },
      ],
    }),
    resolve(s, o) {
      if (o === 0 && s.supplies >= 20 && s.settlement.equipment < MAX_EQUIPMENT) {
        s.supplies -= 20;
        s.settlement.equipment++;
        addLog(s, 'Good steel, a little rusted. Equipment improved.', 'good');
      } else if (o === 1 && s.supplies >= 30) {
        if (grantRandomSpecial(s, 'From the merchant: ')) s.supplies -= 30;
        else addLog(s, 'The merchant has nothing you have not already seen.');
      } else addLog(s, 'The merchant rolls on, looking for a road.');
    },
  },
  echo: {
    make: () => ({
      id: 'echo',
      title: 'The Hum Beneath',
      text: 'The ground here hums. Pressing an ear to it, you can almost hear where the heart of the blight is beating.',
      options: [
        { label: 'Listen', hint: 'Reveals the heart · the wilds grow restless' },
        { label: 'Cover it with earth', hint: 'Nothing happens' },
      ],
    }),
    resolve(s, o) {
      if (o === 0) {
        s.heart.seen = { x: s.heart.x, y: s.heart.y, at: s.time, uncertain: false };
        s.threat += 10;
        addLog(s, `You hear it, slow and enormous, in the ${sectorName(s.heart)}. Its place is marked on the map.`, 'info');
      } else addLog(s, 'You bury the sound. It does not bury easily.');
    },
  },
};

const STRANGE = ['cellar', 'shrine', 'echo', 'merchant'];
const DAILY = ['wanderer', 'fever', 'merchant'];

export function triggerStrangeEvent(s: GameState, finder: Colonist) {
  if (s.event) return;
  s.event = EVENTS[pick(s.rng, STRANGE)]!.make(s);
  s.event.text = `${finder.name}, out in the ${sectorName(finder)}: ${s.event.text}`;
}

export function maybeDailyEvent(s: GameState) {
  if (!s.event && chance(s.rng, 0.12)) s.event = EVENTS[pick(s.rng, DAILY)]!.make(s);
}

export function resolveEvent(s: GameState, option: number) {
  if (!s.event) return;
  const id = s.event.id;
  s.event = null;
  EVENTS[id]!.resolve(s, option);
}
