// Checks the conventions in next/AGENTS.md and next/app/AGENTS.md that a script can.
// Each rule names itself in its failure. Grandfathered files sit in
// scripts/lint-exemptions.json with a reason; delete the entry when the file is fixed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks } from './checks.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exemptions = JSON.parse(readFileSync(path.join(app, 'scripts/lint-exemptions.json'), 'utf8'));
const platformFile = /\.(web|native|ios|android)\.tsx?$/;
const restrictedRoles = ['tab', 'tablist', 'tabpanel', 'combobox', 'listbox', 'option', 'slider', 'adjustable', 'dialog', 'menu', 'menuitem', 'radiogroup', 'switch'];

function walk(dir) {
  return readdirSync(path.join(app, dir)).flatMap(entry => {
    const file = path.join(dir, entry);
    if (statSync(path.join(app, file)).isDirectory()) return walk(file);
    return /\.tsx?$/.test(entry) ? [file] : [];
  });
}

function importsOf(source) {
  return [...source.matchAll(/(?:import|export)\s[^;]*?from\s+'([^']+)'|import\('([^']+)'\)|require\('([^']+)'\)/g)]
    .map(match => match[1] ?? match[2] ?? match[3]);
}

function exportsOf(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, '');
      if (name) names.add(name);
    }
  }
  if (/export\s+default\b/.test(source)) names.add('default');
  return names;
}

function exempt(rule, file) {
  return Boolean(exemptions[rule]?.[file]);
}

const files = [...walk('src'), ...walk('app')];
const problems = [];
const report = (rule, file, message) => { if (!exempt(rule, file)) problems.push(`${rule}: ${file}: ${message}`); };

for (const file of files) {
  const source = readFileSync(path.join(app, file), 'utf8');
  const imports = importsOf(source);
  const shared = !platformFile.test(file);

  if (file.startsWith('app/')) {
    for (const target of imports) {
      if (/\/src\/(pds|jam-connection|storage|[\w-]*-storage)$/.test(target)) report('route-boundaries', file, `route files compose screens; move the ${path.basename(target)} call into src/`);
    }
  }

  if (shared) {
    for (const target of imports) {
      if (/\.(web|native|ios|android)$/.test(target)) report('platform-seams', file, `imports ${target} directly; import the base name and let the bundler pick the platform file`);
    }
    if (/(?<![\w.])(document|window|localStorage|sessionStorage|navigator)\.\w/.test(source)) {
      report('platform-seams', file, 'touches a browser global in shared code; put it behind a .web.ts seam');
    }
  }

  for (const match of source.matchAll(/(?<![[\w])(?:accessibilityRole|role)=\{?['"]([a-z]+)['"]/g)) {
    if (restrictedRoles.includes(match[1])) report('hand-rolled-roles', file, `role "${match[1]}" by hand; reuse the shared control or add one under src/behaviors/`);
  }

  if (imports.includes('expo-file-system')) {
    for (const match of source.matchAll(/^.*\.(copy|move)\(.*$/gm)) {
      if (!/\b(await|return)\b|\.then\(/.test(match[0])) report('fs-sync', file, `${match[1]}() returns a promise in expo-file-system; await it or use ${match[1]}Sync()`);
    }
  }

  for (const match of source.matchAll(/(?:^[ \t]*\/\/.*\n){4,}/gm)) {
    const line = source.slice(0, match.index).split('\n').length;
    report('comment-length', file, `comment block at line ${line} runs past three lines; rationale goes in the PR or docs`);
  }
}

for (const file of files.filter(file => /\.web\.tsx?$/.test(file))) {
  const base = file.replace(/\.web(\.tsx?)$/, '');
  const sibling = files.find(other => other === base + '.ts' || other === base + '.tsx');
  if (!sibling) {
    report('seam-exports', file, 'has no shared or native sibling');
    continue;
  }
  const web = exportsOf(readFileSync(path.join(app, file), 'utf8'));
  const other = exportsOf(readFileSync(path.join(app, sibling), 'utf8'));
  const missing = [...web].filter(name => !other.has(name)).concat([...other].filter(name => !web.has(name)));
  if (missing.length) report('seam-exports', file, `exports differ from ${sibling}: ${missing.join(', ')}`);
}

const helpers = new Set(['check-code', 'checks', 'pds-browser-fixture', 'queue-fixture', 'desktop-player-check', 'write-oauth-metadata', 'generate-space-mac-vectors', 'check-large-upload-stream']);
for (const entry of readdirSync(path.join(app, 'scripts'))) {
  const name = entry.replace(/\.(cjs|mjs|mts|json|md)$/, '');
  if (!/^check-/.test(name) || helpers.has(name) || entry.endsWith('.json') || entry.endsWith('.md')) continue;
  if (!checks[name]) report('browser-checks', `scripts/${entry}`, 'is not in scripts/checks.mjs; add what it covers');
}

for (const [rule, entries] of Object.entries(exemptions)) {
  for (const file of Object.keys(entries)) {
    try { statSync(path.join(app, file)); } catch { problems.push(`lint-exemptions: ${rule}: ${file} no longer exists; remove its entry`); }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}. Rules and fixes: next/app/contributing/README.md#lint`);
  process.exitCode = 1;
} else {
  console.log(`checked ${files.length} files`);
}
