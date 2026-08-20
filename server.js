const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const app = express();
app.use(cors());
app.use(express.static(__dirname));

let articlesCache = {}; 
const CACHE_DURATION = 10 * 60 * 1000;

const MLB_TEAMS_MAP = {
  'Arizona Diamondbacks': 'arizona-diamondbacks-full-game-replay',
  'Atlanta Braves': 'atlanta-braves-full-game-replay',
  'Baltimore Orioles': 'baltimore-orioles-full-game-replay',
  'Boston Red Sox': 'boston-red-sox-full-game-replay',
  'Chicago Cubs': 'chicago-cubs-full-game-replay',
  'Chicago White Sox': 'chicago-white-sox-full-game-replay',
  'Cincinnati Reds': 'cincinnati-reds-full-game-replay',
  'Cleveland Guardians': 'cleveland-guardians-full-game-replay',
  'Colorado Rockies': 'colorado-rockies-full-game-replay',
  'Detroit Tigers': 'detroit-tigers-full-game-replay',
  'Houston Astros': 'houston-astros-full-game-replay',
  'Kansas City Royals': 'kansas-city-royals-full-game-replay',
  'Los Angeles Angels': 'los-angeles-angels-full-game-replay',
  'Los Angeles Dodgers': 'los-angeles-dodgers-full-game-replay',
  'Miami Marlins': 'miami-marlins-full-game-replay',
  'Milwaukee Brewers': 'milwaukee-brewers-full-game-replay',
  'Minnesota Twins': 'minnesota-twins-full-game-replay',
  'New York Mets': 'new-york-mets-full-game-replay',
  'New York Yankees': 'new-york-yankees-full-game-replay',
  'Oakland Athletics': 'oakland-athletics-full-game-replay',
  'Philadelphia Phillies': 'philadelphia-phillies-full-game-replay',
  'Pittsburgh Pirates': 'pittsburgh-pirates-full-game-replay',
  'San Diego Padres': 'san-diego-padres-full-game-replay',
  'San Francisco Giants': 'san-francisco-giants-full-game-replay',
  'Seattle Mariners': 'seattle-mariners-full-game-replay',
  'St. Louis Cardinals': 'st-louis-cardinals-full-game-replay',
  'Tampa Bay Rays': 'tampa-bay-rays-full-game-replay',
  'Texas Rangers': 'texas-rangers-full-game-replay',
  'Toronto Blue Jays': 'toronto-blue-jays-full-game-replay',
  'Washington Nationals': 'washington-nationals-full-game-replay'
};

const MLB_TEAMS = Object.keys(MLB_TEAMS_MAP);

function parseConfig(configStr) {
  if (!configStr) return null;
  try {
    let decoded = configStr;
    if (decoded.includes('%')) {
      try { decoded = decodeURIComponent(decoded); } catch (e) {}
    }
    return JSON.parse(decoded);
  } catch (e) {
    return null;
  }
}

function getHubPosterUrl(req) {
  return `${req.protocol}://${req.get('host')}/poster.jpg`;
}

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://mlblive.net/'
};

async function fetchArticlesFromUrl(targetUrl) {
  const now = Date.now();
  if (articlesCache[targetUrl] && (now - articlesCache[targetUrl].lastFetch) < CACHE_DURATION) {
    return articlesCache[targetUrl].data;
  }

  try {
    console.log(`[SCRAPE] Đang cào dữ liệu danh sách từ: ${targetUrl}`);
    const { data } = await axios.get(targetUrl, { headers: HTTP_HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);
    const articles = [];
    const seenHrefs = new Set();
    const currentYear = dayjs().year();

    $('a').each((_, el) => {
      let href = $(el).attr('href');
      let title = $(el).text().trim() || $(el).attr('title') || '';

      if (!href || !title) return;
      if (!href.includes('full-game-replay') || href.endsWith('/full-game-replay')) return;

      if (href.startsWith('/')) {
        href = `https://mlblive.net${href}`;
      }

      if (seenHrefs.has(href)) return;

      const dateMatch = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i);
      let dateVNText = 'Không rõ ngày';
      let dateISO = new Date().toISOString();
      let articleYear = null;

      if (dateMatch) {
        const parsedDate = dayjs.tz(dateMatch[0], 'MMMM D, YYYY', 'America/New_York');
        if (parsedDate.isValid()) {
          dateVNText = parsedDate.tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY');
          dateISO = parsedDate.toISOString();
          articleYear = parsedDate.year();
        }
      } else {
        const yearMatch = title.match(/\b(20\d{2})\b/);
        if (yearMatch) articleYear = parseInt(yearMatch[1], 10);
      }

      if (articleYear && articleYear !== currentYear) return;

      const parent = $(el).closest('div, li, article');
      let img = parent.find('img').attr('data-lazy-src') || 
                parent.find('img').attr('data-src') || 
                parent.find('img').attr('src') || '';
      if (img && img.startsWith('/')) img = `https://mlblive.net${img}`;

      seenHrefs.add(href);
      articles.push({
        id: 'vid_' + Buffer.from(href).toString('base64'),
        title,
        href,
        img,
        dateVNText,
        dateISO
      });
    });

    console.log(`[SCRAPE SUCCESS] Tìm thấy ${articles.length} trận đấu!`);
    articlesCache[targetUrl] = { data: articles, lastFetch: now };
    return articles;
  } catch (err) {
    console.error(`[SCRAPE ERROR] ${targetUrl}:`, err.message);
    return articlesCache[targetUrl] ? articlesCache[targetUrl].data : [];
  }
}

// 1. Config Page
app.get(['/', '/configure', '/:config', '/:config/configure'], (req, res) => {
  const config = parseConfig(req.params.config);
  const selectedTeams = (config && config.teams) ? config.teams : [];

  const teamCheckboxes = MLB_TEAMS.map(team => {
    const isChecked = selectedTeams.includes(team) ? 'checked' : '';
    return `
      <label style="display: inline-block; width: 45%; margin: 5px 2%;">
        <input type="checkbox" name="teams" value="${team}" ${isChecked}> ${team}
      </label>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>MLB Replays - Config</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #121212; color: #fff; max-width: 600px; margin: auto; }
        .card { background: #1e1e1e; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
        h2 { color: #00d2ff; margin-top: 0; }
        button { background: #00d2ff; color: #000; border: none; padding: 12px 20px; font-weight: bold; border-radius: 5px; cursor: pointer; width: 100%; margin-top: 15px; }
        button:hover { background: #0099cc; }
        .output { margin-top: 15px; word-break: break-all; background: #2a2a2a; padding: 10px; border-radius: 5px; display: none; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>⚾ MLB Replays Hub</h2>
        <p>Chọn các đội bóng m muốn theo dõi (Mỗi đội là 1 Season):</p>
        <form id="configForm">
          <div style="max-height: 300px; overflow-y: auto; background: #252525; padding: 10px; border-radius: 5px;">
            ${teamCheckboxes}
          </div>
          <button type="button" onclick="generateLink()">Tạo Link Cài Đặt Nuvio</button>
        </form>
        <div id="result" class="output">
          <p style="margin: 0 0 5px 0; color: #aaa;">Copy link dán vào Nuvio:</p>
          <strong id="manifestUrl" style="color: #00f0ff;"></strong>
        </div>
      </div>

      <script>
        function generateLink() {
          const checkboxes = document.querySelectorAll('input[name="teams"]:checked');
          const selectedTeams = Array.from(checkboxes).map(cb => cb.value);
          let configPath = '';
          if (selectedTeams.length > 0) {
            configPath = '/' + encodeURIComponent(JSON.stringify({ teams: selectedTeams }));
          }
          const fullUrl = window.location.origin + configPath + '/manifest.json';
          document.getElementById('manifestUrl').innerText = fullUrl;
          document.getElementById('result').style.display = 'block';
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// 2. Manifest
app.get(['/manifest.json', '/:config/manifest.json'], (req, res) => {
  const config = parseConfig(req.params.config);
  let nameExtra = '';
  if (config && config.teams && config.teams.length > 0) {
    nameExtra = ` (${config.teams.length} đội)`;
  }

  res.json({
    id: 'org.mlblive.gmt7.nhontruong.addon',
    version: '1.5.4',
    name: `MLB Replays${nameExtra}`,
    description: 'Trung tâm tổng hợp Replay MLB phân loại theo đội bóng',
    behaviorHints: { configurable: true, configurationRequired: false },
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
    catalogs: [
      {
        type: 'series',
        id: 'mlblive_catalog',
        name: 'MLB Replays'
      }
    ]
  });
});

// 3. Catalog
app.get(['/catalog/*', '/:config/catalog/*'], (req, res) => {
  const posterUrl = getHubPosterUrl(req);
  res.json({
    metas: [
      {
        id: 'mlb_replays_hub',
        type: 'series',
        name: '⚾ MLB Replays Hub',
        poster: posterUrl,
        background: posterUrl,
        description: 'Bấm vào để chọn và xem danh sách các trận đấu Replay theo từng đội bóng.'
      }
    ]
  });
});

// 4. Meta
app.get(['/meta/*', '/:config/meta/*'], async (req, res) => {
  try {
    const config = parseConfig(req.params.config);
    const selectedTeams = (config && config.teams) ? config.teams : [];
    const posterUrl = getHubPosterUrl(req);

    const videos = [];
    let seasonLegend = '';

    if (selectedTeams.length > 0) {
      seasonLegend = selectedTeams.map((team, idx) => `• Season ${idx + 1}: ${team}`).join('\n');

      for (let teamIdx = 0; teamIdx < selectedTeams.length; teamIdx++) {
        const teamName = selectedTeams[teamIdx];
        const teamSlug = MLB_TEAMS_MAP[teamName];
        const teamUrl = `https://mlblive.net/${teamSlug}`;
        
        const articles = await fetchArticlesFromUrl(teamUrl);
        const seasonNum = teamIdx + 1;
        let epNum = 1;

        articles.forEach(art => {
          videos.push({
            id: art.id,
            title: art.title,
            season: seasonNum,
            episode: epNum++,
            released: art.dateISO,
            thumbnail: art.img,
            overview: `📅 Ngày đấu (Giờ VN): ${art.dateVNText}\nĐội: ${teamName}`
          });
        });
      }
    } else {
      seasonLegend = '• Season 1: Tất cả các trận mới nhất năm nay';
      const articles = await fetchArticlesFromUrl('https://mlblive.net/');
      let epNum = 1;
      articles.forEach(art => {
        videos.push({
          id: art.id,
          title: art.title,
          season: 1,
          episode: epNum++,
          released: art.dateISO,
          thumbnail: art.img,
          overview: `📅 Ngày đấu (Giờ VN): ${art.dateVNText}`
        });
      });
    }

    res.json({
      meta: {
        id: 'mlb_replays_hub',
        type: 'series',
        name: '⚾ MLB Replays Hub',
        poster: posterUrl,
        background: posterUrl,
        description: `Danh sách các đội bóng tương ứng với từng Season:\n${seasonLegend}`,
        videos: videos
      }
    });
  } catch (err) {
    console.error('[META ERROR]:', err.message);
    res.json({ meta: { id: 'mlb_replays_hub', type: 'series', name: '⚾ MLB Replays Hub', videos: [] } });
  }
});

// 5. Stream Endpoint (LOG CHI TIẾT LOGIC CÀO OK.RU)
app.get(['/stream/*', '/:config/stream/*'], async (req, res) => {
  try {
    const fullPath = req.path;
    const parts = fullPath.split('/');
    const rawFilename = parts[parts.length - 1];
    let rawId = rawFilename.replace('.json', '');

    if (rawId.startsWith('vid_')) {
      rawId = rawId.replace('vid_', '');
    }

    let targetUrl = '';
    try {
      targetUrl = Buffer.from(rawId, 'base64').toString('utf-8');
    } catch (e) {
      return res.json({ streams: [] });
    }

    if (!targetUrl.startsWith('http')) {
      return res.json({ streams: [] });
    }

    console.log(`\n========================================`);
    console.log(`[STREAM REQUEST] Đang cào link video từ: ${targetUrl}`);
    
    const { data } = await axios.get(targetUrl, { headers: HTTP_HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);
    const streams = [];
    let hasOkRu = false;

    $('iframe').each((index, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      
      if (src) {
        if (src.startsWith('//')) {
          src = 'https:' + src;
        }

        console.log(` ➜ [IFRAME #${index + 1}] Tìm thấy link: ${src}`);

        let serverName = `Server #${index + 1}`;
        if (src.includes('ok.ru')) {
          hasOkRu = true;
          serverName = `⚾ OK.ru Direct #${index + 1}`;
          console.log(`    ✅ [OK.RU CHECK] Lấy thành công link OK.ru!`);
        } else if (src.includes('mail.ru')) {
          serverName = `⚾ Mail.ru Direct #${index + 1}`;
          console.log(`    📦 [MAIL.RU CHECK] Lấy thành công link Mail.ru!`);
        }

        streams.push({
          title: serverName,
          url: src,
          behaviorHints: {
            requestHeaders: { 
              'Referer': 'https://mlblive.net/',
              'User-Agent': HTTP_HEADERS['User-Agent']
            }
          }
        });
      }
    });

    if (hasOkRu) {
      console.log(`🎉 [STREAM RESULT] ĐÃ BẮT ĐƯỢC LINK OK.RU THÀNH CÔNG!`);
    } else {
      console.log(`⚠️ [STREAM RESULT] Không tìm thấy link OK.ru trong bài viết này (Tìm thấy ${streams.length} iframe khác).`);
    }
    console.log(`========================================\n`);

    res.json({ streams });
  } catch (err) {
    console.error('❌ [STREAM ERROR]:', err.message);
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`MLB Replays Addon v1.5.4 running at http://localhost:${PORT}`));
