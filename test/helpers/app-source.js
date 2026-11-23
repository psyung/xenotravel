import { readFileSync, readdirSync } from 'node:fs';

const pub = new URL('../../public/', import.meta.url);

function filesUnder(dir) {
  return readdirSync(new URL(dir + '/', pub), { withFileTypes: true }).flatMap((entry) => {
    const path = dir + '/' + entry.name;
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function screenFiles() {
  return ['pages', 'ui', 'map'].flatMap(filesUnder).sort();
}

export function appSource() {
  const files = ['app.js', ...screenFiles().filter((f) => f.endsWith('.js'))];
  return files.map((f) => readFileSync(new URL(f, pub), 'utf8')).join('\n');
}
