import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['README.md'];
for (const directory of ['docs', 'verification']) {
  for (const entry of await readdir(join(root, directory))) {
    if (entry.endsWith('.md')) files.push(`${directory}/${entry}`);
  }
}
let missing = 0;
for (const file of files) {
  const text = await readFile(join(root, file), 'utf8');
  for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    try {
      await access(resolve(root, dirname(file), decodeURIComponent(target)));
    } catch {
      console.error(`${file}: missing relative link ${target}`);
      missing++;
    }
  }
}
console.log(`Checked local links in ${files.length} documentation files; ${missing} missing`);
process.exitCode = missing ? 1 : 0;
