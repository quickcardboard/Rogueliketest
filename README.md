# Holdfast (working title)

A real-time colony survival roguelike. Your colony sits in a valley that keeps changing; a heart of blight is growing toward it from somewhere in the fog. You set priorities and make the big calls. Your people do the rest.

See [DESIGN.md](DESIGN.md) for the design document.

## Prototype

```
npm install
npm run dev              # play in the browser
npm test                 # simulation tests
npm run sim              # headless balance run: npm run sim -- <runs> <startSeed>
npm run build:artifact   # bundle into one self-contained HTML page
```

Code layout: `src/core` is the deterministic simulation (no DOM), `src/ui` draws it on a canvas and hosts the panels, `sim/` holds the balance bot.
