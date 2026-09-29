import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSiteFlags } from '../scripts/lib/site-flags.mjs';

// Согласованность infra/nginx с флагом Метрики и журналы без полного IP (ep05 T06; plan ep05 →
// Key Decisions «CSP и флаг меняются одним PR», «Журналы: маска IP»). Конфиги читаются из
// репозитория и разбираются простым парсером скобок; проверки — чистые функции, поэтому каждая
// проба — мутант текста конфига, а не правка файла. На сервере то же держит `nginx -t` и
// порядок установки из infra/README.md; тест доказывает, что в репозитории нет рассинхрона.

const NGINX = fileURLToPath(new URL('../infra/nginx/', import.meta.url));
const SITE_YAML = fileURLToPath(new URL('../src/content/site.yaml', import.meta.url));
const VHOST_FILES = ['belkascm.ru.conf', 'staging.belkascm.ru.conf'] as const;
const MAPS_FILE = 'belkascm-maps.conf';
const LOG_FORMAT = 'belkascm_anon';

const read = (path: string) => readFileSync(NGINX + path, 'utf8');

// Прежняя строка CSP из security-headers.conf (ep01 T15, plan ep01 B6) — дословно. Проба
// «ничего не ослабили»: строгий сниппет обязан совпасть с ней побайтно.
const STRICT_REFERENCE =
  `add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; ` +
  `script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'" always;`;

// Что добавляет сниппет «Метрика» к строгой политике — и ничего больше (справка Метрики,
// способ «внешний скрипт», без Вебвизора и карты кликов; источник — в шапке сниппета).
const METRIKA_ADDITIONS: Record<string, string[]> = {
  'img-src': ['https://mc.yandex.ru'],
  'script-src': ['https://mc.yandex.ru', 'https://yastatic.net'],
  'connect-src': ["'self'", 'https://mc.yandex.ru'],
};

type Stmt = { text: string; depth: number };
type Server = { where: string; stmts: Stmt[] };
type Vhost = { file: string; text: string };

/** Комментарии `#` до конца строки вне кавычек. */
function stripComments(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Блоки `server { … }` верхнего уровня: директивы с глубиной (1 — уровень server). */
function parseServers(file: string, text: string): Server[] {
  const src = stripComments(text);
  const servers: Server[] = [];
  let depth = 0;
  let current: Server | null = null;
  let buf = '';
  let quote: string | null = null;
  for (const ch of src) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === '{') {
      if (depth === 0 && buf.trim() === 'server') {
        current = { where: `${file}, server #${servers.length + 1}`, stmts: [] };
        servers.push(current);
      }
      depth++;
      buf = '';
    } else if (ch === '}') {
      depth--;
      buf = '';
      if (depth === 0) current = null;
    } else if (ch === ';') {
      if (current) current.stmts.push({ text: buf.trim().replace(/\s+/g, ' '), depth });
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (depth !== 0) throw new Error(`${file}: несбалансированные скобки`);
  return servers;
}

const isHttps = (server: Server) => server.stmts.some((s) => s.depth === 1 && /^listen\s.*\b443\b/.test(s.text));
const CSP_INCLUDE = /^include\s+\S*\/(csp-[^/\s]+\.conf)$/;

function servers(vhosts: Vhost[]): Server[] {
  return vhosts.flatMap(({ file, text }) => parseServers(file, text));
}

/** Каждый HTTPS-блок: ровно один CSP-сниппет на уровне server, и тот, что задаёт флаг. */
function cspErrors(vhosts: Vhost[], metrikaEnabled: boolean): string[] {
  const expected = metrikaEnabled ? 'csp-metrika.conf' : 'csp-strict.conf';
  const errors: string[] = [];
  for (const server of servers(vhosts)) {
    if (server.stmts.some((s) => /^add_header\s+Content-Security-Policy\b/i.test(s.text))) {
      errors.push(`${server.where}: CSP задан прямо в vhost, а не сниппетом`);
    }
    if (!isHttps(server)) continue;
    const includes = server.stmts.filter((s) => CSP_INCLUDE.test(s.text));
    if (includes.some((s) => s.depth !== 1)) errors.push(`${server.where}: CSP-сниппет подключён не на уровне server`);
    const top = includes.filter((s) => s.depth === 1);
    if (top.length === 0) errors.push(`${server.where}: нет CSP-сниппета`);
    else if (top.length > 1) errors.push(`${server.where}: CSP-сниппетов ${top.length}, нужен ровно один`);
    else {
      const name = CSP_INCLUDE.exec(top[0]!.text)![1];
      if (name !== expected) {
        errors.push(`${server.where}: подключён ${name}, при metrikaEnabled: ${metrikaEnabled} нужен ${expected}`);
      }
    }
  }
  return errors;
}

/** Каждый server belkascm: свой access_log с форматом без IP и error_log уровня crit. */
function logErrors(vhosts: Vhost[]): string[] {
  const errors: string[] = [];
  for (const server of servers(vhosts)) {
    const access = server.stmts.filter((s) => /^access_log\s/.test(s.text));
    const error = server.stmts.filter((s) => /^error_log\s/.test(s.text));
    if (!access.some((s) => s.depth === 1)) {
      errors.push(`${server.where}: нет своего access_log — унаследуется журнал http с полным IP`);
    }
    for (const s of access) {
      if (s.text.split(' ')[2] !== LOG_FORMAT) errors.push(`${server.where}: «${s.text}» — формат не ${LOG_FORMAT}`);
    }
    if (!error.some((s) => s.depth === 1)) errors.push(`${server.where}: нет своего error_log`);
    for (const s of error) {
      if (s.text.split(' ')[2] !== 'crit') errors.push(`${server.where}: «${s.text}» — уровень не crit`);
    }
  }
  return errors;
}

const FULL_IP_VARS = /\$(remote_addr|binary_remote_addr|realip_remote_addr|http_x_forwarded_for|http_x_real_ip|proxy_add_x_forwarded_for)\b/;

function logFormatErrors(mapsText: string): string[] {
  const match = new RegExp(`\\blog_format\\s+${LOG_FORMAT}\\s+([^;]*);`).exec(stripComments(mapsText));
  if (!match) return [`${MAPS_FILE}: нет log_format ${LOG_FORMAT}`];
  const errors: string[] = [];
  if (FULL_IP_VARS.test(match[1]!)) errors.push(`log_format ${LOG_FORMAT}: в формате полный адрес посетителя`);
  if (!match[1]!.includes('$belkascm_anon_ip')) errors.push(`log_format ${LOG_FORMAT}: нет $belkascm_anon_ip`);
  return errors;
}

type MapRule = { key: string; value: string };

/** Правила `map $remote_addr $belkascm_anon_ip { … }` в порядке конфига. */
function anonMapRules(mapsText: string): MapRule[] {
  const body = /\bmap\s+\$remote_addr\s+\$belkascm_anon_ip\s*\{([^}]*)\}/.exec(stripComments(mapsText));
  if (!body) throw new Error(`${MAPS_FILE}: нет map $remote_addr $belkascm_anon_ip`);
  return body[1]!
    .split(';')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^("([^"]*)"|\S+)\s+("([^"]*)"|\S+)$/.exec(line);
      if (!m) throw new Error(`не разобрано правило map: ${line}`);
      return { key: m[2] ?? m[1]!, value: m[4] ?? m[3]! };
    });
}

/** Значение $belkascm_anon_ip для адреса — как его вычисляет nginx: первое совпавшее правило. */
function anonymize(rules: MapRule[], addr: string): string {
  const expand = (value: string, groups: Record<string, string | undefined>, numbered: string[]) =>
    value
      .replace(/\$(\d+)/g, (_, n: string) => numbered[Number(n)] ?? '')
      .replace(/\$([A-Za-z_]\w*)/g, (_, name: string) => (name === 'remote_addr' ? addr : (groups[name] ?? '')));
  for (const { key, value } of rules) {
    if (key === 'default') continue;
    if (key.startsWith('~')) {
      const insensitive = key.startsWith('~*');
      const match = new RegExp(key.slice(insensitive ? 2 : 1), insensitive ? 'i' : '').exec(addr);
      if (match) return expand(value, match.groups ?? {}, [...match]);
    } else if (key === addr) {
      return expand(value, {}, []);
    }
  }
  return rules.find((r) => r.key === 'default')?.value ?? '';
}

// Образцы: адрес → что пишет журнал. IPv4 — /24, IPv6 — первые три группы (/48).
const MASK_SAMPLES: [string, string][] = [
  ['203.0.113.77', '203.0.113.0'],
  ['10.1.2.3', '10.1.2.0'],
  ['2001:db8:85a3:8d3:1319:8a2e:370:7348', '2001:db8:85a3::'],
  ['2001:db8:85a3::7348', '2001:db8:85a3::'],
  ['2001:db8::1', '2001:db8::'],
  ['2001::8a2e:370:7348', '2001::'],
  ['::1', '::'],
  ['unix:', '-'],
];

function maskErrors(mapsText: string): string[] {
  const rules = anonMapRules(mapsText);
  return MASK_SAMPLES.flatMap(([addr, expected]) => {
    const got = anonymize(rules, addr);
    return got === expected ? [] : [`маска ${addr} → «${got}», ожидалось «${expected}»`];
  });
}

/** Строки-директивы сниппета (без комментариев и пустых строк). */
const directiveLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));

function parsePolicy(snippet: string): Map<string, string[]> {
  const lines = directiveLines(snippet);
  const m = /^add_header Content-Security-Policy "([^"]*)" always;$/.exec(lines.length === 1 ? lines[0]! : '');
  if (!m) throw new Error('в сниппете не одна строка add_header Content-Security-Policy');
  return new Map(
    m[1]!.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name!, sources] as [string, string[]];
    }),
  );
}

function metrikaSnippetErrors(strictText: string, metrikaText: string): string[] {
  const expected = parsePolicy(strictText);
  for (const [name, sources] of Object.entries(METRIKA_ADDITIONS)) {
    expected.set(name, [...(expected.get(name) ?? []), ...sources.filter((s) => !(expected.get(name) ?? []).includes(s))]);
  }
  const got = parsePolicy(metrikaText);
  const errors: string[] = [];
  for (const name of new Set([...expected.keys(), ...got.keys()])) {
    const want = [...(expected.get(name) ?? [])].sort().join(' ');
    const have = [...(got.get(name) ?? [])].sort().join(' ');
    if (want !== have) errors.push(`csp-metrika: ${name} — «${have}», ожидалось «${want}»`);
  }
  return errors;
}

const realVhosts = (): Vhost[] => VHOST_FILES.map((file) => ({ file, text: read(file) }));

/** Мутант: правка текста одного vhost (строка должна найтись). */
function mutate(file: (typeof VHOST_FILES)[number], from: string | RegExp, to: string): Vhost[] {
  return realVhosts().map((v) => {
    if (v.file !== file) return v;
    const text = v.text.replace(from, to);
    if (text === v.text) throw new Error(`мутант не применился: ${String(from)}`);
    return { file, text };
  });
}

const STRICT_INCLUDE = 'include /etc/nginx/snippets/belkascm/csp-strict.conf;';

describe('infra/nginx: CSP в двух сниппетах', () => {
  it('csp-strict.conf — прежняя строка побайтно, других директив нет', () => {
    expect(directiveLines(read('snippets/csp-strict.conf'))).toEqual([STRICT_REFERENCE]);
  });

  it('security-headers.conf больше не задаёт CSP', () => {
    expect(read('snippets/security-headers.conf')).not.toMatch(/^\s*add_header\s+Content-Security-Policy/im);
  });

  it('csp-metrika.conf — строгая политика плюс ровно нужное Метрике', () => {
    expect(metrikaSnippetErrors(read('snippets/csp-strict.conf'), read('snippets/csp-metrika.conf'))).toEqual([]);
    const policy = parsePolicy(read('snippets/csp-metrika.conf'));
    expect(policy.has('frame-src')).toBe(false);
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
    expect([...policy.values()].flat()).not.toContain('*');
  });

  it('проба: лишнее в csp-metrika.conf (frame-src, unsafe-inline, wss:) ловится', () => {
    const strict = read('snippets/csp-strict.conf');
    // Мутанты — только в строке директивы: те же слова есть в комментарии сниппета.
    const metrika = directiveLines(read('snippets/csp-metrika.conf'))[0]!;
    for (const [from, to] of [
      ["form-action 'none'", "form-action 'none'; frame-src blob: https://mc.yandex.ru"],
      ["script-src 'self'", "script-src 'self' 'unsafe-inline'"],
      ['connect-src ', 'connect-src wss://mc.yandex.ru '],
      [' https://yastatic.net', ''],
    ] as const) {
      const mutant = metrika.replace(from, to);
      expect(mutant).not.toBe(metrika);
      expect(metrikaSnippetErrors(strict, mutant).length).toBeGreaterThan(0);
    }
  });

  it('HTTPS-блоков три: два прода и один стейджинга', () => {
    expect(servers(realVhosts()).filter(isHttps).map((s) => s.where)).toEqual([
      'belkascm.ru.conf, server #2',
      'belkascm.ru.conf, server #3',
      'staging.belkascm.ru.conf, server #2',
    ]);
  });

  it('metrikaEnabled из site.yaml ⇔ сниппет во всех HTTPS-блоках обоих vhost', () => {
    const { metrikaEnabled } = readSiteFlags(SITE_YAML);
    expect(cspErrors(realVhosts(), metrikaEnabled)).toEqual([]);
  });

  it('проба: флаг в другом состоянии — рассинхрон в каждом из трёх блоков', () => {
    const { metrikaEnabled } = readSiteFlags(SITE_YAML);
    expect(cspErrors(realVhosts(), !metrikaEnabled)).toHaveLength(3);
  });

  it('мутант: второй CSP-сниппет в блоке', () => {
    const vhosts = mutate('staging.belkascm.ru.conf', STRICT_INCLUDE, `${STRICT_INCLUDE}\n    ${STRICT_INCLUDE.replace('strict', 'metrika')}`);
    expect(cspErrors(vhosts, false)).toEqual(['staging.belkascm.ru.conf, server #2: CSP-сниппетов 2, нужен ровно один']);
  });

  it('мутант: блок без CSP', () => {
    const vhosts = mutate('belkascm.ru.conf', /\n\s*include \/etc\/nginx\/snippets\/belkascm\/csp-strict\.conf;(?![\s\S]*csp-strict)/, '');
    expect(cspErrors(vhosts, false)).toEqual(['belkascm.ru.conf, server #3: нет CSP-сниппета']);
  });

  it('мутант: CSP-сниппет внутри location, а не на уровне server', () => {
    const base = mutate('staging.belkascm.ru.conf', `    ${STRICT_INCLUDE}\n`, '');
    const vhosts = base.map((v) =>
      v.file === 'staging.belkascm.ru.conf'
        ? { ...v, text: v.text.replace('try_files $uri $uri/ =404;', `try_files $uri $uri/ =404;\n        ${STRICT_INCLUDE}`) }
        : v,
    );
    expect(cspErrors(vhosts, false)).toEqual([
      'staging.belkascm.ru.conf, server #2: CSP-сниппет подключён не на уровне server',
      'staging.belkascm.ru.conf, server #2: нет CSP-сниппета',
    ]);
  });

  it('мутант: CSP прямо в vhost', () => {
    const vhosts = mutate('belkascm.ru.conf', STRICT_INCLUDE, `${STRICT_INCLUDE}\n    add_header Content-Security-Policy "default-src *" always;`);
    expect(cspErrors(vhosts, false)).toEqual(['belkascm.ru.conf, server #2: CSP задан прямо в vhost, а не сниппетом']);
  });
});

describe('infra/nginx: журналы без полного IP', () => {
  it('у каждого из пяти server belkascm свой access_log с belkascm_anon и error_log crit', () => {
    const all = servers(realVhosts());
    expect(all).toHaveLength(5);
    expect(logErrors(realVhosts())).toEqual([]);
  });

  it('мутант: access_log без формата', () => {
    const vhosts = mutate('staging.belkascm.ru.conf', 'belkascm-staging.access.log belkascm_anon;', 'belkascm-staging.access.log;');
    expect(logErrors(vhosts)).toEqual([
      'staging.belkascm.ru.conf, server #1: «access_log /var/log/nginx/belkascm-staging.access.log» — формат не belkascm_anon',
    ]);
  });

  it('мутант: server без access_log — унаследовал бы журнал с полным IP', () => {
    const vhosts = mutate('belkascm.ru.conf', /\n\s*access_log [^\n]*/, '');
    expect(logErrors(vhosts)).toEqual([
      'belkascm.ru.conf, server #1: нет своего access_log — унаследуется журнал http с полным IP',
    ]);
  });

  it('мутант: error_log уровня error', () => {
    const vhosts = mutate('belkascm.ru.conf', /(belkascm\.error\.log) crit;(?![\s\S]*error\.log)/, '$1;');
    expect(logErrors(vhosts)).toEqual([
      'belkascm.ru.conf, server #3: «error_log /var/log/nginx/belkascm.error.log» — уровень не crit',
    ]);
  });

  it('log_format belkascm_anon без полного адреса и с маской', () => {
    expect(logFormatErrors(read(MAPS_FILE))).toEqual([]);
    const mutant = read(MAPS_FILE).replace("'$belkascm_anon_ip - ", "'$remote_addr - ");
    expect(logFormatErrors(mutant)).toEqual([
      'log_format belkascm_anon: в формате полный адрес посетителя',
      'log_format belkascm_anon: нет $belkascm_anon_ip',
    ]);
  });

  it('belkascm-maps.conf подключается раньше vhost (log_format до access_log)', () => {
    // sites-enabled/* nginx читает в порядке имён (glob, C-локаль).
    for (const file of VHOST_FILES) expect(MAPS_FILE < file).toBe(true);
  });

  it('маска map на образцах: IPv4 — /24, IPv6 — три группы, прочее — «-»', () => {
    expect(maskErrors(read(MAPS_FILE))).toEqual([]);
  });

  it('проба: правило IPv4 без маски или без строки — ловится', () => {
    const maps = read(MAPS_FILE);
    const noMask = maps.replace('$belkascm_ip4.0;', '$remote_addr;');
    expect(noMask).not.toBe(maps);
    expect(maskErrors(noMask)).toEqual(['маска 203.0.113.77 → «203.0.113.77», ожидалось «203.0.113.0»', 'маска 10.1.2.3 → «10.1.2.3», ожидалось «10.1.2.0»']);
    const noLine = maps.replace(/\n\s*"~\^\(\?<belkascm_ip4>[^\n]*/, '');
    expect(noLine).not.toBe(maps);
    expect(maskErrors(noLine)).toContain('маска 203.0.113.77 → «-», ожидалось «203.0.113.0»');
  });

  it('проба: IPv6 с четырьмя группами ловится', () => {
    const maps = read(MAPS_FILE);
    const four = maps.replace('[0-9a-f]+:[0-9a-f]+:[0-9a-f]+):', '[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+):');
    expect(four).not.toBe(maps);
    expect(maskErrors(four)).toContain('маска 2001:db8:85a3:8d3:1319:8a2e:370:7348 → «2001:db8:85a3:8d3::», ожидалось «2001:db8:85a3::»');
  });
});
