// Production build: the diorama prototype (index.html) and the graybox slice (slice/index.html)
// as two independent bundles in dist/. They are built separately so the diorama stays a single
// script, which the offline desktop packager relies on.
//   node tools/build.mjs [--base=/beyond-the-bend/]
import { build } from 'vite';

const arg = process.argv.slice(2);
const i = arg.findIndex((a) => a === '--base' || a.startsWith('--base='));
const base = i < 0 ? undefined : arg[i].includes('=') ? arg[i].slice(arg[i].indexOf('=') + 1) : arg[i + 1];
const shared = base ? { base } : {};
await build(shared);
await build({ ...shared, publicDir: false, build: { emptyOutDir: false, rolldownOptions: { input: 'slice/index.html' } } });
