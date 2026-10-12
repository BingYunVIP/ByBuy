import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.md', '.svg', '.txt', '.xml']);
const forbidden = [
  { label: 'remote domain', pattern: /remote-provider\.invalid/i },
  { label: 'remote service marker', pattern: /upstream|上游/i },
];

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  }));
  return files.flat();
}

const leaks = [];
for (const file of await listFiles(root)) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const content = await readFile(file, 'utf8');
  for (const item of forbidden) {
    if (item.pattern.test(content)) leaks.push(`${path.relative(root, file)}: ${item.label}`);
  }
}

if (leaks.length) {
  console.error(`Browser output contains forbidden service details:\n${leaks.map(item => `- ${item}`).join('\n')}`);
  process.exit(1);
}

console.info('Browser output leak check passed.');
