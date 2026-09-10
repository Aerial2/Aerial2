/**
 * 自托管的主页统计卡片生成器
 *
 * 直接调用 GitHub GraphQL API 取数，本地渲染 SVG，
 * 不依赖 github-readme-stats / activity-graph / trophy 等第三方实例。
 *
 * 用法：GITHUB_TOKEN=xxx node scripts/gen-cards.mjs
 * 输出：assets/card-stats.svg、assets/card-top-langs.svg、assets/card-activity.svg
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const USER = process.env.GH_USER || 'Aerial2';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const OUT_DIR = process.env.OUT_DIR || 'assets';

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
  white: '#ffffff',
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

/** SVG 文本节点 */
const txt = (x, y, size, fill, content, { weight = 400, anchor = 'start', opacity = 1 } = {}) =>
  `<text x="${x}" y="${y}" font-family='${FONT}' font-size="${size}" font-weight="${weight}" ` +
  `fill="${fill}" text-anchor="${anchor}" opacity="${opacity}">${esc(content)}</text>`;

/* -------------------------------- 数据获取 -------------------------------- */
const QUERY = `
query ($u: String!) {
  user(login: $u) {
    followers { totalCount }
    following { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazers { totalCount }
        forkCount
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
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

async function fetchAll() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'aerial2-profile-card-generator',
    },
    body: JSON.stringify({ query: QUERY, variables: { u: USER } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`GraphQL 请求失败 (${res.status}): ${JSON.stringify(body.errors || body)}`);
  }
  return body.data.user;
}

/* -------------------------------- 卡片渲染 -------------------------------- */
const shell = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
  `role="img" aria-label="GitHub stats card">\n` +
  `  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.bg}" stroke="${C.border}"/>\n` +
  inner +
  `\n</svg>\n`;

/** 统计卡片：六个关键指标 */
function renderStats(user) {
  const W = 495;
  const H = 195;
  const repos = user.repositories;
  const stars = repos.nodes.reduce((s, r) => s + r.stargazers.totalCount, 0);
  const forks = repos.nodes.reduce((s, r) => s + r.forkCount, 0);
  const cc = user.contributionsCollection;

  const cells = [
    { label: 'Star 总数', value: num(stars), color: C.title },
    { label: '公开仓库', value: num(repos.totalCount), color: C.accent },
    { label: '关注者', value: num(user.followers.totalCount), color: C.green },
    { label: '年度贡献', value: num(cc.contributionCalendar.totalContributions), color: C.title },
    { label: '年度提交', value: num(cc.totalCommitContributions), color: C.accent },
    { label: 'Issue / PR', value: num(cc.totalIssueContributions + cc.totalPullRequestContributions), color: C.green },
  ];

  const cols = [30, 195, 360];
  const rows = [92, 158];
  let inner = '';
  inner += txt(30, 42, 18, C.title, `${USER} 的 GitHub 统计`, { weight: 600 });
  inner += `<line x1="30" y1="56" x2="${W - 30}" y2="56" stroke="${C.border}" stroke-width="1"/>`;

  cells.forEach((cell, i) => {
    const x = cols[i % 3];
    const y = rows[Math.floor(i / 3)];
    inner += txt(x, y, 24, cell.color, cell.value, { weight: 700 });
    inner += txt(x, y + 20, 12, C.muted, cell.label);
  });

  inner += txt(W - 30, 42, 11, C.muted, `forks ${num(forks)}`, { anchor: 'end' });
  return shell(W, H, inner);
}

/** 语言分布卡片 */
function renderLangs(user) {
  const W = 495;
  const H = 195;
  const totals = new Map();
  let color = new Map();
  let all = 0;

  for (const repo of user.repositories.nodes) {
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      if (!color.has(name)) color.set(name, edge.node.color || C.accent);
      totals.set(name, (totals.get(name) || 0) + edge.size);
      all += edge.size;
    }
  }

  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const denom = all || 1;

  let inner = txt(30, 42, 18, C.title, '最常使用的语言', { weight: 600 });
  inner += `<line x1="30" y1="56" x2="${W - 30}" y2="56" stroke="${C.border}" stroke-width="1"/>`;

  if (!top.length) {
    inner += txt(30, 110, 13, C.muted, '暂无数据');
    return shell(W, H, inner);
  }

  const barX = 130;
  const barW = 275;
  top.forEach(([name, size], i) => {
    const pct = (size / denom) * 100;
    const y = 80 + i * 22;
    inner += txt(30, y + 10, 12, C.text, name);
    inner += `<rect x="${barX}" y="${y}" width="${barW}" height="11" rx="5.5" fill="${C.grid}"/>`;
    inner += `<rect x="${barX}" y="${y}" width="${Math.max(3, (barW * pct) / 100).toFixed(1)}" height="11" rx="5.5" fill="${color.get(name)}"/>`;
    inner += txt(W - 30, y + 10, 11, C.muted, `${pct.toFixed(1)}%`, { anchor: 'end' });
  });

  return shell(W, H, inner);
}

/** 近一年贡献曲线 */
function renderActivity(user) {
  const W = 840;
  const H = 220;
  const cal = user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0));

  const left = 45;
  const right = W - 30;
  const top = 78;
  const bottom = H - 34;
  const max = Math.max(1, ...weeks);

  const xAt = (i) => left + (i * (right - left)) / Math.max(1, weeks.length - 1);
  const yAt = (v) => bottom - (v / max) * (bottom - top);

  let inner = txt(left, 42, 18, C.title, '近一年贡献活动', { weight: 600 });
  inner += txt(right, 42, 12, C.muted, `累计 ${num(cal.totalContributions)} 次`, { anchor: 'end' });
  inner += `<line x1="${left}" y1="56" x2="${right}" y2="56" stroke="${C.border}" stroke-width="1"/>`;

  // 水平网格
  for (let g = 0; g <= 3; g++) {
    const y = top + ((bottom - top) * g) / 3;
    inner += `<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`;
  }

  const pts = weeks.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
  inner += `<path d="M ${left},${bottom} L ${pts.join(' L ')} L ${right},${bottom} Z" fill="url(#areaGrad)"/>`;
  inner += `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.title}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

  // 峰值点
  const peak = weeks.indexOf(max);
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
const user = await fetchAll();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/card-stats.svg`, renderStats(user));
writeFileSync(`${OUT_DIR}/card-top-langs.svg`, renderLangs(user));
writeFileSync(`${OUT_DIR}/card-activity.svg`, renderActivity(user));

console.log('已生成 card-stats.svg / card-top-langs.svg / card-activity.svg');
