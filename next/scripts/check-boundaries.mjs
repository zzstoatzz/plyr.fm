import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectories = ['core/src', 'web/src', 'app/src', 'app/app'];
const privateClients = /^(?:plyr-next|plyr-web-next)(?:\/|$)/;
const browserGlobals = new Set([
  'window', 'document', 'navigator', 'location', 'indexedDB', 'localStorage', 'sessionStorage',
  'caches', 'XMLHttpRequest', 'HTMLElement', 'File', 'Blob'
]);
const failures = [];

function filesIn(directory) {
  const entries = readdirSync(path.join(root, directory), { withFileTypes: true });
  return entries.flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file);
    return /\.(?:[cm]?[jt]sx?|svelte)$/.test(entry.name) ? [file] : [];
  });
}

function checkImport(file, specifier) {
  const owner = file.split('/')[0];
  const target = specifier.startsWith('.') ? path.normalize(path.join(path.dirname(file), specifier)) : '';
  if (/^\$core(?:\/|$)/.test(specifier) || (target.startsWith('core/') && owner !== 'core')) {
    failures.push(`${file} must import ${specifier} through @plyr/next-core`);
  } else if (privateClients.test(specifier) || (/^(?:app|web)\//.test(target) && !target.startsWith(owner + '/'))) {
    failures.push(`${file} cannot import ${specifier} across workspaces`);
  }
  if (owner === 'core' && /^(?:svelte|react|react-native(?:-[^/]+)?|expo(?:-[^/]+)?|@expo\/[^/]+|@react-native\/[^/]+|node:[^/]+)(?:\/|$)/.test(specifier)) {
    failures.push(`${file} cannot import platform dependency ${specifier}`);
  }
}

function checkSource(file, source) {
  const filename = file.endsWith('.svelte') ? file + '.ts' : file;
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const core = file.startsWith('core/');
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) checkImport(file, node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      checkImport(file, node.argument.literal.text);
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require')) {
      const [first] = node.arguments;
      if (first && ts.isStringLiteralLike(first)) checkImport(file, first.text);
    }
    if (core && ts.isIdentifier(node) && browserGlobals.has(node.text)) {
      failures.push(`${file} references browser global ${node.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}

for (const file of ['app/index.js', ...sourceDirectories.flatMap(filesIn)]) {
  if (file.startsWith('app/') && /\.web\.[jt]sx?$/.test(file)) failures.push(`${file} belongs in next/web`);
  if (file.startsWith('core/') && /\.(?:web|native|ios|android)\.[jt]sx?$/.test(file)) {
    failures.push(`${file} has a platform-specific filename`);
  }
  const source = readFileSync(path.join(root, file), 'utf8');
  if (file.startsWith('app/') && /\bPlatform\.OS\s*(?:[!=]={1,2})\s*['"]web['"]/.test(source)) {
    failures.push(`${file} checks for the removed Expo web target`);
  }
  const scripts = file.endsWith('.svelte')
    ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1])
    : [source];
  for (const script of scripts) checkSource(file, script);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
