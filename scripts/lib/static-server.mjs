// @ts-check
// Встроенный статический сервер по каталогу сборки (ep02 T03): check-layout открывает страницы в
// Chrome через него, T13 рендерит OG-шаблон (file:// не отдаёт woff2 из соседнего каталога).
// Только node:http, только 127.0.0.1, свободный порт. Файлы вне корня не отдаются.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/** MIME по расширению; остальное — application/octet-stream. */
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Файл под корнем для пути запроса: `/путь/` → `путь/index.html`, каталог → его `index.html`.
 * `undefined` — файла нет или путь уходит из корня (`..`, `\`, NUL, битое %-кодирование).
 * @param {string} root абсолютный путь каталога
 * @param {string} urlPath путь запроса без query
 * @returns {string | undefined}
 */
export function resolveFile(root, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\\')) return undefined;
  if (path.split('/').some((part) => part === '..')) return undefined;
  const base = resolve(root);
  let file = resolve(base, `.${path}`);
  if (file !== base && !file.startsWith(base + sep)) return undefined;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  return existsSync(file) && statSync(file).isFile() ? file : undefined;
}

/**
 * Поднимает сервер по каталогу сборки. Неизвестный путь → `404.html` сборки с кодом 404.
 * @param {string} root каталог сборки
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startStaticServer(root) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const urlPath = (req.url ?? '/').split(/[?#]/, 1)[0] ?? '/';
    const found = resolveFile(base, urlPath);
    const notFound = join(base, '404.html');
    const file = found ?? (existsSync(notFound) ? notFound : undefined);
    const status = found ? 200 : 404;
    if (file === undefined) {
      res.writeHead(404, { 'content-type': MIME['.txt'] }).end(req.method === 'HEAD' ? undefined : 'not found');
      return;
    }
    const type = MIME[/** @type {keyof typeof MIME} */ (extname(file).toLowerCase())] ?? 'application/octet-stream';
    res.writeHead(status, { 'content-type': type, 'content-length': statSync(file).size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done(undefined));
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('сервер не получил порт');
  return {
    origin: `http://${address.address}:${address.port}`,
    close: () =>
      new Promise((done, fail) => {
        server.closeAllConnections();
        server.close((error) => (error ? fail(error) : done()));
      }),
  };
}
