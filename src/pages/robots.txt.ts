// robots.txt по окружению (T16): прод разрешает индексацию и указывает sitemap,
// стейджинг и разработка закрыты целиком.
import type { APIRoute } from 'astro';
import { SITE_ENV } from 'astro:env/server';
import { robotsTxt } from '../lib/site-env';

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(robotsTxt(SITE_ENV), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
