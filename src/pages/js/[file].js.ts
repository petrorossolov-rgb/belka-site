// Скрипты сайта (ep05 T08): единственный — /js/consent.js, и только при site.flags.metrikaEnabled.
// При выключенном флаге маршрутов нет, файла в сборке нет. Скрипт — свой файл, а не инлайн:
// CSP сайта — script-src 'self' (infra/nginx/snippets/csp-*.conf). Тело — src/client/consent.mjs
// как есть, без бандлинга: он написан для классического <script src defer>.
import type { APIRoute, GetStaticPaths } from 'astro';
import consent from '../../client/consent.mjs?raw';
import { getSite } from '../../lib/content';

export const prerender = true;

const FILES: Record<string, string> = { consent };

export const getStaticPaths = (async () => {
  const site = await getSite();
  return site.flags.metrikaEnabled ? [{ params: { file: 'consent' } }] : [];
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(FILES[params.file ?? ''], {
    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
  });
