/**
 * Tạo manifest.json ở thư mục gốc repo để Chrome load unpacked từ root
 * (mọi đường dẫn trỏ vào dist/).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distManifest = JSON.parse(
  readFileSync(join(root, 'dist', 'manifest.json'), 'utf8'),
);

function prefixPath(value) {
  if (typeof value !== 'string') return value;
  if (
    value.startsWith('dist/') ||
    value.startsWith('http') ||
    value.startsWith('chrome')
  ) {
    return value;
  }
  return `dist/${value}`;
}

function walk(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => {
      if (typeof item === 'string' && /\.(js|html|png|css|json)$/i.test(item)) {
        return prefixPath(item);
      }
      if (typeof item === 'object' && item !== null) return walk(item);
      return item;
    });
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'default_popup' || key === 'options_page') {
        out[key] = prefixPath(val);
      } else if (key === 'service_worker') {
        out[key] = prefixPath(val);
      } else if (key === 'resources' && Array.isArray(val)) {
        out[key] = val.map(prefixPath);
      } else if (
        typeof val === 'string' &&
        (key === '16' || key === '48' || key === '128' || key === 'js')
      ) {
        out[key] = prefixPath(val);
      } else {
        out[key] = walk(val);
      }
    }
    return out;
  }
  return obj;
}

const rootManifest = walk(distManifest);
writeFileSync(
  join(root, 'manifest.json'),
  JSON.stringify(rootManifest, null, 2),
  'utf8',
);
console.log('manifest.json (root) ← dist/manifest.json');
