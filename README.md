# Holdfast (working title)

A roguelike strategy game about a besieged settlement in a shifting wilderness. You hold the colony, keep your intel fresh, and search for the heart of the blight before it reaches you.

See [DESIGN.md](DESIGN.md) for the design document.

## Phase 0 prototype

```
npm install
npm run dev        # play in the browser
npm test           # unit tests
npm run sim        # headless balance run: npm run sim -- <runs> <startSeed>
```

**How to play:** click a tile in the wilds, add squads to a party, then **Scout** or **act** on the tile. Queue construction in the Settlement panel and set squads to **Work**. Press **Next day** (or Enter). Squads away from the colony do not defend it.
