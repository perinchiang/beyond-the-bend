// Build a self-contained demo from the same production output as GitHub Pages.
// macOS also gets a local WKWebView app. No server, installer or download at launch.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const output = 'test-results/desktop';
await mkdir(output, { recursive: true });
let html = await readFile('dist/index.html', 'utf8');
const scriptTag = html.match(/<script\b[^>]+src="([^"]+)"[^>]*><\/script>/);
const cssTag = html.match(/<link\b[^>]+href="([^"]+\.css)"[^>]*>/);
if (!scriptTag || !cssTag) throw new Error('Expected the Vite script and stylesheet in dist/index.html');
const script = await readFile(join('dist/assets', basename(scriptTag[1])), 'utf8');
const css = await readFile(join('dist/assets', basename(cssTag[1])), 'utf8');
const model = await readFile('dist/models/car.glb');
html = html.replace(scriptTag[0], () => '<script type="module">' + script.replace(/<\/script/gi, '<\\/script') + '</script>')
  .replace(cssTag[0], () => '<style>' + css + '</style>')
  .replace('<canvas id="view"', () => '<canvas data-model="data:model/gltf-binary;base64,' + model.toString('base64') + '" id="view"');
const file = join(output, 'Beyond the Bend.html');
await writeFile(file, html);
console.log(file);
if (process.platform === 'darwin') {
  const contents = join(output, 'Beyond the Bend.app/Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await mkdir(join(contents, 'Resources'), { recursive: true });
  await copyFile(file, join(contents, 'Resources/index.html'));
  await copyFile('tools/desktop/Info.plist', join(contents, 'Info.plist'));
  execFileSync('xcrun', ['swiftc', '-O', 'tools/desktop/main.swift', '-o', join(contents, 'MacOS/BeyondTheBend')], { stdio: 'inherit' });
  execFileSync('codesign', ['--force','--sign','-',join(output,'Beyond the Bend.app')], { stdio: 'inherit' });
  console.log(join(output, 'Beyond the Bend.app'));
}
