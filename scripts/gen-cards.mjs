/**
 * 自托管的主页统计卡片生成器
 *
 * 取数策略（都可被默认 GITHUB_TOKEN 访问）：
 *   - REST /users/:user                            → 关注者、仓库数
 *   - REST /users/:user/repos                      → Star / Fork / 主语言
 *   - REST /repos/:user/:repo/languages            → 语言字节数（仅非 fork 仓库）
 *   - GraphQL contributionsCollection              → 年度贡献、提交、Issue、贡献日历
 *
 * 不依赖 github-readme-stats / activity-graph / trophy 等第三方公共实例。
 *
 * 用法：GITHUB_TOKEN=xxx node scripts/gen-cards.mjs
 * 输出：assets/card-stats.svg、assets/card-top-langs.svg、assets/card-activity.svg
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const USER = process.env.GH_USER || 'Aerial2';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OUT_DIR = process.env.OUT_DIR || 'assets';
const API = 'https://api.github.com';

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}

/* ---------------------------------- 主题 ---------------------------------- */
const C = {
  bg: '#0D1117',
  border: '#30363d',
  grid: '#21262d',
  title: '#00CEC9',
  text: '#c9d1d9',
  muted: '#8b949e',
  accent: '#6C5CE7',
  green: '#00B894',
};
const FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif';

/* --------------------------------- 小工具 --------------------------------- */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (n) => Number(n || 0).toLocaleString('en-US');

const txt = (x, y, size, fill, content, { weight = 400, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-family='${FONT}' font-size="${size}" font-weight="${weight}" ` +
  `fill="${fill}" text-anchor="${anchor}">${esc(content)}</text>`;

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'aerial2-profile-card-generator',
};

async function rest(path) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`REST ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/* -------------------------------- 取数 -------------------------------- */
async function fetchProfile() {
  return rest(`/users/${USER}`);
}

async function fetchRepos() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const chunk = await rest(`/users/${USER}/repos?per_page=100&type=owner&page=${page}`);
    all.push(...chunk);
    if (chunk.length < 100) break;
  }
  return all.filter((r) => !r.fork);
}

async function fetchLanguages(repos) {
  const totals = new Map();
  for (const repo of repos.slice(0, 30)) {
    try {
      const langs = await rest(`/repos/${USER}/${repo.name}/languages`);
      for (const [name, bytes] of Object.entries(langs)) {
        totals.set(name, (totals.get(name) || 0) + bytes);
      }
    } catch (err) {
      console.warn(`跳过 ${repo.name} 的语言统计：${err.message}`);
    }
  }
  return totals;
}

const CONTRIB_QUERY = `
query ($u: String!) {
  user(login: $u) {
    contributionsCollection {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

async function fetchContributions() {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CONTRIB_QUERY, variables: { u: USER } }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors).slice(0, 300));
  return body.data.user.contributionsCollection;
}

/* -------------------------------- 卡片渲染 -------------------------------- */
const shell = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
  `role="img" aria-label="GitHub stats card">\n` +
  `  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>\n` +
  inner +
  `\n</svg>\n`;

function renderStats(profile, repos, contrib) {
  const W = 495;
  const H = 195;
  const stars = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const forks = repos.reduce((s, r) => s + r.forks_count, 0);

  const cells = [
    { label: 'Star 总数', value: num(stars), color: C.title },
    { label: '公开仓库', value: num(profile.public_repos), color: C.accent },
    { label: '关注者', value: num(profile.followers), color: C.green },
    { label: '年度贡献', value: num(contrib.calendar.totalContributions), color: C.title },
    { label: '年度提交', value: num(contrib.commits), color: C.accent },
    { label: 'Issue / PR', value: num(contrib.issues + contrib.prs), color: C.green },
  ];

  const cols = [30, 195, 360];
  const rows = [92, 158];

  let inner = txt(30, 42, 18, C.title, `${USER} 的 GitHub 统计`, { weight: 600 });
  inner += txt(W - 30, 42, 11, C.muted, `fork 仓库 ${num(repos.length)} 个`, { anchor: 'end' });
  inner += `<line x1="30" y1="56" x2="${W - 30}" y2="56" stroke="${C.border}" stroke-width="1"/>`;

  cells.forEach((cell, i) => {
    const x = cols[i % 3];
    const y = rows[Math.floor(i / 3)];
    inner += txt(x, y, 24, cell.color, cell.value, { weight: 700 });
    inner += txt(x, y + 20, 12, C.muted, cell.label);
  });

  return shell(W, H, inner);
}

const LANG_COLORS = {
  TypeScript: '#3178C6',
  JavaScript: '#F7DF1E',
  Rust: '#dea584',
  Go: '#00ADD8',
  Python: '#3572A5',
  Vue: '#41B883',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Java: '#b07219',
  Shell: '#89e051',
  Lua: '#000080',
  Smali: '#cccccc',
};

function renderLangs(langTotals) {
  const W = 495;
  const H = 195;

  let inner = txt(30, 42, 18, C.title, '最常使用的语言', { weight: 600 });
  inner += `<line x1="30" y1="56" x2="${W - 30}" y2="56" stroke="${C.border}" stroke-width="1"/>`;

  const entries = [...langTotals.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    inner += txt(30, 112, 13, C.muted, '暂无数据');
    return shell(W, H, inner);
  }

  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const top = entries.slice(0, 5);
  const barX = 130;
  const barW = 275;

  top.forEach(([name, size], i) => {
    const pct = (size / total) * 100;
    const y = 80 + i * 22;
    inner += txt(30, y + 10, 12, C.text, name);
    inner += `<rect x="${barX}" y="${y}" width="${barW}" height="11" rx="5.5" fill="${C.grid}"/>`;
    inner += `<rect x="${barX}" y="${y}" width="${Math.max(3, (barW * pct) / 100).toFixed(1)}" height="11" ` +
      `rx="5.5" fill="${LANG_COLORS[name] || C.accent}"/>`;
    inner += txt(W - 30, y + 10, 11, C.muted, `${pct.toFixed(1)}%`, { anchor: 'end' });
  });

  return shell(W, H, inner);
}

function renderActivity(contrib) {
  const W = 840;
  const H = 220;
  const weeks = contrib.calendar.weeks.map((w) =>
    w.contributionDays.reduce((s, d) => s + d.contributionCount, 0)
  );
  const series = weeks.length ? weeks : [0, 0];

  const left = 45;
  const right = W - 30;
  const top = 78;
  const bottom = H - 34;
  const max = Math.max(1, ...series);

  const xAt = (i) => left + (i * (right - left)) / Math.max(1, series.length - 1);
  const yAt = (v) => bottom - (v / max) * (bottom - top);

  let inner = txt(left, 42, 18, C.title, '近一年贡献活动', { weight: 600 });
  inner += txt(right, 42, 12, C.muted, `累计 ${num(contrib.calendar.totalContributions)} 次`, {
    anchor: 'end',
  });
  inner += `<line x1="${left}" y1="56" x2="${right}" y2="56" stroke="${C.border}" stroke-width="1"/>`;

  for (let g = 0; g <= 3; g++) {
    const y = top + ((bottom - top) * g) / 3;
    inner += `<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" ` +
      `stroke="${C.grid}" stroke-width="1"/>`;
  }

  const pts = series.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
  inner += `<path d="M ${left},${bottom} L ${pts.join(' L ')} L ${right},${bottom} Z" fill="url(#areaGrad)"/>`;
  inner += `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.title}" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>`;

  const peak = series.indexOf(max);
  if (peak >= 0 && max > 0) {
    inner += `<circle cx="${xAt(peak).toFixed(1)}" cy="${yAt(max).toFixed(1)}" r="4" fill="${C.green}"/>`;
  }

  inner += txt(left, H - 12, 11, C.muted, '最近 12 个月（按周聚合）');
  inner += txt(right, H - 12, 11, C.muted, `峰值 ${num(max)} 次/周`, { anchor: 'end' });

  const defs =
    `  <defs>\n    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">\n` +
    `      <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.55"/>\n` +
    `      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>\n` +
    `    </linearGradient>\n  </defs>\n`;

  return shell(W, H, defs + inner);
}

/* ---------------------------------- 主流程 --------------------------------- */
const profile = await fetchProfile();
const repos = await fetchRepos();
console.log(`非 fork 仓库 ${repos.length} 个`);

const langTotals = await fetchLanguages(repos);

let contrib;
try {
  const cc = await fetchContributions();
  contrib = {
    commits: cc.totalCommitContributions,
    issues: cc.totalIssueContributions,
    prs: cc.totalPullRequestContributions,
    reviews: cc.totalPullRequestReviewContributions,
    calendar: cc.contributionCalendar,
  };
} catch (err) {
  console.warn(`贡献数据获取失败，降级为空数据：${err.message}`);
  contrib = { commits: 0, issues: 0, prs: 0, reviews: 0, calendar: { totalContributions: 0, weeks: [] } };
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/card-stats.svg`, renderStats(profile, repos, contrib));
writeFileSync(`${OUT_DIR}/card-top-langs.svg`, renderLangs(langTotals));
writeFileSync(`${OUT_DIR}/card-activity.svg`, renderActivity(contrib));

console.log('已生成 card-stats.svg / card-top-langs.svg / card-activity.svg');
