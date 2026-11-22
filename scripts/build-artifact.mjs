// Builds the game and inlines it into one self-contained HTML page (for sharing / phone play).
// Usage: node scripts/build-artifact.mjs <output.html>
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'dist/holdfast-standalone.html';
execSync('npx vite build', { stdio: 'inherit' });
const assets = join('dist', 'assets');
const files = readdirSync(assets);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
if (js.includes('</script')) throw new Error('bundle contains a closing script tag');

const html = `<title>Holdfast</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya+SC:wght@500;700&family=Alegreya+Sans:wght@400;700&display=swap">
<style>
${css}
</style>
<div id="app"></div>
<script type="module">
${js}
</script>
`;
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
