# Design Document — Working Title: *Holdfast*

> Living document. Decisions marked **[Decided]** came out of the design interview; everything else is a proposal to be validated by prototyping. Open questions are collected at the end.

---

## 1. Pitch

You lead a settlement besieged by a monstrous horde that grows out of a **living, shifting wilderness**. Scouting tells you what is coming, but the land moves and **information goes stale fast**. Between assaults you spend your two scarce currencies — **Supplies** and **People** — to scout, gather, build, train and set doctrine. Then you watch your colony **defend itself** in a simulated, animated battle. To win, you must find and destroy the **source** of the siege, hidden somewhere in the moving wilds.

**Pillars**
1. **Every person sent out is a defender missing.** The People/Supplies tension drives every decision.
2. **Information is a decaying asset.** Odds are visible, but their accuracy depends on how fresh your intel is.
3. **Prepare, then trust.** The colony fights on its own; the player's skill shows in preparation, not reflexes.
4. **Readable, beautiful, calm.** A stylized low-poly 3D diorama with clean UI; clarity before spectacle.

---

## 2. Fixed parameters **[Decided]**

| Topic | Decision |
|---|---|
| Core decision type | Resource economy |
| Run length | 30–60 minutes |
| Randomness | "Some dice": visible odds, some hidden events |
| Visuals | Stylized low-poly 3D / 2.5D, fixed tilted camera, soft palette, clean modern UI (aesthetic reference: games like *Thronefall*; our own art and design) |
| Theme | Besieged settlement |
| Interaction | Map + event choices |
| Combat | Auto-simulated, animated; colony defends itself |
| Map | Two layers: the **settlement** (districts) + the **surrounding wilds** (shifting nodes) |
| Defense prep | Structures, squad assignment/training, doctrines, equipment & supplies |
| Resources | 2 core (Supplies, People) + Specials |
| Win condition | Break the siege: find and destroy the source |
| Enemy | Monstrous horde spawned by a living environment |
| Pacing | Warning signs, not a fixed countdown |
| Colonists | Squads/groups with roles |
| Battle input | One or two limited interventions |
| Failure | Death spiral, but recoverable |
| Meta-progression | Unlocks only (no permanent power) |
| Platform | Web, TypeScript |
| Intel decay | Event-driven: intel stays valid until the land shifts in its sector, then it is marked uncertain |
| Squad roles | Militia, Archers, Scouts, Builders |
| The source | A single heart that grows toward the colony; if it arrives, the run is lost |
| Tone | Hopeful melancholy: the land is wounded and can heal |

---

## 3. Core loop

One **cycle** = the stretch of days between assaults (typically 3–6 days).

```
┌─► 1. READ THE WILDS     — inspect nodes; each shows intel age & confidence
│   2. ASSIGN SQUADS      — scout / gather / work / train / guard
│   3. INVEST             — spend Supplies on districts, equipment, training; set doctrines
│   4. ADVANCE A DAY      — expeditions resolve, events fire, wilds shift, warning signs update
│      (repeat 1–4 until the assault comes)
│   5. ASSAULT            — animated simulation; player has 1–2 interventions
│   6. AFTERMATH          — casualties, damage, loot, morale-like consequences, new events
└───────────────────────────────────────────────────────────────────────────┘
```

A run is ~6–10 cycles, ending in the **final expedition** against the source.

---

## 4. Resources

### Supplies
The single material currency: food, timber, stone, arrows, medicine all abstracted into one number.
- **Gained** by gathering expeditions, salvage after battles, events, some districts.
- **Spent** on structures, equipment, training, repairs, and **upkeep** (each squad eats per day).
- Upkeep makes People cost Supplies, which ties the two currencies together.

### People (Squads)
Colonists come in **squads** (proposal: 1 squad ≈ 5 people, tracked as squad count + per-squad health 0–5).
- **Roles:** Militia (default), Archers, Builders, Scouts, Healers… (role set to be kept small; start with 3–4).
- **Assignments per day:** Guard · Scout · Gather · Work (build/repair) · Train.
- Squads away from the colony **do not defend** if an assault hits.
- **Gained** through refugees, rescues in the wilds, events, growth districts. Rarely free.
- **Lost** in battle, on dangerous expeditions, to events.

### Specials
Rare, rule-bending items, specialists and relics. Examples:
- *Old Cartographer* — intel from scouting decays half as fast.
- *Bell of the First Wall* — grants an extra battle intervention.
- *Blight Seed* — a captured horde artifact; huge Supplies value, but attracts attacks.

Specials are the main source of **build variety** across runs.

---

## 5. The two maps

### 5.1 The Settlement (districts)
The colony is a small diorama of **districts** arranged around a **Keep** (the core). Proposal: 5–7 district slots.
- Each district hosts one building (Wall Section, Watchtower, Granary, Barracks, Infirmary, Workshop, Shrine…).
- Assaults arrive from **directions**; districts on that side take the hit first.
- Layout matters in the simulation: towers cover adjacent districts, walls slow the horde, the infirmary returns wounded squads.
- If the **Keep** falls, the run ends.

### 5.2 The Wilds (shifting nodes)
A ring of nodes around the settlement, representing the land within reach.
- **Node types:** Forage, Ruins, Refugee Camp, Horde Nest, Blight Zone, Strange Site (event), Source Trail.
- **The land moves:** each day some nodes drift, transform, appear or vanish. Nests grow, forage depletes, blight spreads.
- **Intel decay [Decided: event-driven]:** every tile shows *what you last saw* and *when*. Intel stays valid until the land **shifts** in that tile's sector (one of 8 compass sectors). The player is told only *where* the land shifted ("The land shifts to the NE"), not which tiles changed, so every known tile in that sector becomes **uncertain** (~). Shifts cluster around the heart and grow more frequent as it nears.
- **Scouting** refreshes intel on a node and its neighbours; better scouts see further and more precisely.

---

## 6. Warning signs & assault timing

There is no countdown. Instead the colony tracks **Threat** (hidden) and shows **Signs** (visible, if intel is fresh):
- "Tracks near the eastern ford" → an assault is building from the east.
- "Nests swelling" → the next wave will be larger.
- "Silence in the forest" → assault imminent.

The UI shows a **threat estimate** ("Assault likely in 2–4 days, from the East/North") whose precision depends on intel freshness. Neglect scouting and the estimate widens — or a surprise assault hits while squads are away.

---

## 7. Battle simulation

- Real-time simulation on the 3D settlement diorama, ~60–120 seconds, with speed controls (1×/2×/4×).
- Units are simple low-poly figures; the horde comes in visually distinct **types** (swarmers, brutes, burrowers, fliers…) that scouting can identify in advance.
- **Deterministic given a seed** → reproducible, testable, balanceable by headless simulation.
- **Inputs** come from preparation: districts/structures, squads on Guard (by role & health), equipment level, doctrines.
- **Interventions (1–2 per battle):** Ring the Bell (recall nearby expeditions/rally), Collapse the Bridge, Fire the Stores, Sound Retreat to the Keep. Each costs something.

### Doctrines
A small set of toggles that change colony AI behaviour, e.g.:
- *Hold the Line* vs *Fall Back to the Keep* (casualties vs district damage)
- *Protect the Stores* vs *Protect the People*
- *Volley Fire* vs *Pick Targets* (archer behaviour)

Doctrines are unlocked and swapped between assaults; some cost Supplies or People to change.

---

## 8. Aftermath & the recoverable death spiral

After a battle: casualties, wounded squads, district damage, salvage. Losses compound (fewer people → less gathering → fewer supplies). Recovery valves:
- Refugee and rescue events (people for supplies or risk).
- Desperate measures (strip a district for Supplies, conscript, abandon an outer district).
- Specials that pay off when behind.
- Assault strength scales partly with **your** exposure (nests you leave unchecked), not only with time.

---

## 9. Run arc & win condition

**[Decided] The heart grows toward you.** The source is a single *heart of the blight* that starts at the edge of the wilds and advances one tile toward the colony every 4–6 days, leaving blight and new nests behind. If it reaches the colony, the run is lost. This is the run's clock. Clearing nests heals the land (they become regrowth) and weakens the heart, so pushing back against the blight is also how you make the final strike winnable.

1. **Early (cycles 1–3):** stabilise, learn the land, establish scouting.
2. **Mid (cycles 4–6):** follow **Source Trail** nodes; the source moves, so trails go cold if not followed up.
3. **Late (cycles 7–10):** locate the source and launch the **final expedition**. The colony must withstand a last assault with whoever stays behind.

Proposal: the final expedition is a short sequence of nodes resolved with dice, using the squads and specials you commit.

---

## 10. Meta-progression **[Decided: unlocks only]**

Finishing or losing runs unlocks new **buildings, doctrines, specials, events, horde types and starting colonies**. No permanent stat bonuses; mastery is the progression.

---

## 11. Presentation & tech

### Visual direction
- **Stylized low-poly 3D** with a fixed, tilted (near-isometric) camera over the settlement diorama; light zoom and rotate allowed.
- Flat-shaded models, soft gradient sky, restrained palette, gentle ambient lighting and shadows.
- Day/night cycle signals time passing; assaults happen at dusk/night for drama and readability (torch light, glowing horde).
- The Wilds can be the same 3D world zoomed out, or a stylised map view of the surroundings (to prototype both).
- UI: clean, modern overlay — icons, clear numbers, tooltips with odds, satisfying tweens.
- Art and design are original; the *Thronefall* reference is for overall mood and readability only.

### Tech stack (proposal)
- **TypeScript + Vite**
- **Three.js** for rendering (or Babylon.js; Three.js preferred for size and ecosystem)
- Models: primitives at first, then simple low-poly assets (glTF), authored in Blender or sourced from CC0 packs
- UI: HTML/CSS overlay (possibly a light framework) on top of the WebGL canvas
- **Architecture:** pure, deterministic game-logic core (seeded RNG, no rendering dependencies) + separate renderer/UI layers. Enables headless simulation for balance testing and automated tests.

---

## 12. Prototype plan

1. **Phase 0 — Logic prototype (text/minimal UI):** resources, squads, wilds with intel decay, warning signs, an abstract battle formula. Goal: are the decisions interesting?
2. **Phase 1 — 3D vertical slice:** settlement diorama in Three.js, simple battle simulation with primitive units, 1 intervention, 3 horde types.
3. **Phase 2 — Full loop:** source trail and final expedition, doctrines, specials, events.
4. **Phase 3 — Content, balance & polish:** headless balance sims, art pass, audio, unlocks.

---

## 13. Open questions

- Exact district count and building list.
- Can squads be reassigned mid-day, or only at day start?
- Does the Wilds view live in the same 3D scene or a separate map screen?
- How readable should the heart's trail be? (Prototype: scouting near blight reports the direction to the heart.)
- What does the final expedition look like mechanically?
- How much control does the camera have during battles?
- Final name. (Working title: *Holdfast*.)

---

## 14. Phase 0 prototype: status

Playable in the browser (`npm run dev`). It is deliberately plain: a grid of the wilds, panels and text, with no 3D yet. The goal is to test whether the decisions are interesting.

**What is in it**
- 9×9 wilds around the colony with forage, ruins, survivors, nests, blight, strange sites and regrowth.
- Event-driven intel decay by sector, watchtowers that keep nearby intel fresh.
- The heart: hidden, advancing, findable by scouting and blight trails; strike it with a party (visible odds).
- Squads of up to 5 with four roles, wounded/fit split, training, merging, and Guard / Work / Expedition assignments.
- Settlement: walls (3 levels) and towers in four directions, granary, infirmary, workshop, hearth, equipment levels.
- Doctrines (hold vs fall back, protect people vs stores).
- Warning signs and an assault estimate whose precision depends on fresh intel.
- Round-based battle resolution with three interventions (bell, fire the stores, retreat).
- Six choice events, five specials.
- Deterministic seeded core, unit tests, and a headless bot for balance runs (`npm run sim`).

**Balance snapshot (simple heuristic bot, 500 seeds):** about 28% wins, runs average 16 days and 3–4 assaults. Losses split roughly 60/40 between the heart arriving and the keep falling. A thoughtful human should do noticeably better than this bot; playtesting will tell.

**Known gaps:** no saving across versions, no meta-progression, the battle is a dice resolver rather than a spatial simulation, very little flavour text, no sound.
