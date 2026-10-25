import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('dist');
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.md', '.svg', '.txt', '.xml']);

/* 真实上游域名只存在于 .env（或环境变量），这里运行时读取，源码里不写任何域名。 */
function configuredHosts() {
  const values = [process.env.ChatGPT_Web, process.env.Team_Web];
  try {
    for (const match of readFileSync('.env', 'utf8').matchAll(/^(?:ChatGPT_Web|Team_Web)=(.*)$/gm)) values.push(match[1]);
  } catch { /* 没有 .env 时只做通用检查 */ }
  const hosts = new Set();
  for (const value of values) {
    for (const part of String(value ?? '').split(',')) {
      try { hosts.add(new URL(part.trim()).hostname.replace(/^www\./, '')); } catch { /* 空值或非网址 */ }
    }
  }
  return [...hosts];
}

const forbidden = [
  { label: 'remote domain', pattern: /remote-provider\.invalid/i },
  ...configuredHosts().map(host => ({ label: 'configured service domain', pattern: new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })),
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
