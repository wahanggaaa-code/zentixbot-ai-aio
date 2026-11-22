// Embed the existing licensed Lucide SVGs as CSS masks to avoid a request per icon.
// Run after updating an icon. The original SVGs and license stay in dashboard/icons/lucide.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const cssPath = 'dashboard/features.css';
const start = '/* BEGIN generated Lucide masks: run node scripts/build-dashboard-icons.js */';
const end = '/* END generated Lucide masks */';
const css = readFileSync(cssPath, 'utf8');
const files = readdirSync('dashboard/icons/lucide').filter(name => name.endsWith('.svg')).sort();
const rules = files.map(file => {
  const name = file.slice(0, -4);
  const svg = readFileSync(`dashboard/icons/lucide/${file}`);
  return `.zx-icon-${name}{--zx-icon:url("data:image/svg+xml;base64,${svg.toString('base64')}")}`;
}).join('\n');
const block = `${start}\n${rules}\n${end}`;
if (css.includes(start) && css.includes(end)) {
  writeFileSync(cssPath, css.slice(0, css.indexOf(start)) + block + css.slice(css.indexOf(end) + end.length));
} else {
  const first = css.indexOf('.zx-icon-audio-lines{');
  const lastRule = '.zx-icon-wrench{--zx-icon:url("icons/lucide/wrench.svg")}';
  const last = css.indexOf(lastRule);
  if (first < 0 || last < first) throw new Error('Lucide mask block not found');
  writeFileSync(cssPath, css.slice(0, first) + block + css.slice(last + lastRule.length));
}
