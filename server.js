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

// Danh sách 30 đội MLB
const MLB_TEAMS = [
  'Arizona Diamondbacks', 'Atlanta Braves', 'Baltimore Orioles', 'Boston Red Sox',
  'Chicago Cubs', 'Chicago White Sox', 'Cincinnati Reds', 'Cleveland Guardians',
  'Colorado Rockies', 'Detroit Tigers', 'Houston Astros', 'Kansas City Royals',
  'Los Angeles Angels', 'Los Angeles Dodgers', 'Miami Marlins', 'Milwaukee Brewers',
  'Minnesota Twins', 'New York Mets', 'New York Yankees', 'Oakland Athletics',
  'Philadelphia Phillies', 'Pittsburgh Pirates', 'San Diego Padres', 'San Francisco Giants',
  'Seattle Mariners', 'St. Louis Cardinals', 'Tampa Bay Rays', 'Texas Rangers',
  'Toronto Blue Jays', 'Washington Nationals'
];

// Từ khóa tìm kiếm thông minh cho từng đội bóng
const TEAM_KEYWORDS = {
  'Arizona Diamondbacks': ['diamondbacks', 'd-backs', 'arizona'],
  'Atlanta Braves': ['braves', 'atlanta'],
  'Baltimore Orioles': ['orioles', 'baltimore'],
  'Boston Red Sox': ['red sox', 'boston'],
  'Chicago Cubs': ['cubs'],
  'Chicago White Sox': ['white sox'],
  'Cincinnati Reds': ['reds', 'cincinnati'],
  'Cleveland Guardians': ['guardians', 'cleveland'],
  'Colorado Rockies': ['rockies', 'colorado'],
  'Detroit Tigers': ['tigers', 'detroit'],
  'Houston Astros': ['astros', 'houston'],
  'Kansas City Royals': ['royals', 'kansas'],
  'Los Angeles Angels': ['angels'],
  'Los Angeles Dodgers': ['dodgers'],
  'Miami Marlins': ['marlins', 'miami'],
  'Milwaukee Brewers': ['brewers', 'milwaukee'],
  'Minnesota Twins': ['twins', 'minnesota'],
  'New York Mets': ['mets'],
  'New York Yankees': ['yankees'],
  'Oakland Athletics': ['athletics', 'oakland', "a's"],
  'Philadelphia Phillies': ['phillies', 'philadelphia'],
  'Pittsburgh Pirates': ['pirates', 'pittsburgh'],
  'San Diego Padres': ['padres', 'san diego'],
  'San Francisco Giants': ['giants', 'san francisco'],
  'Seattle Mariners': ['mariners', 'seattle'],
  'St. Louis Cardinals': ['cardinals', 'st. louis', 'st louis'],
  'Tampa Bay Rays': ['rays', 'tampa'],
  'Texas Rangers': ['rangers', 'texas'],
  'Toronto Blue Jays': ['blue jays', 'toronto'],
  'Washington Nationals': ['nationals', 'washington']
};

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

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://mlblive.net/'
};

// 1. Giao diện Cấu hình
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
      <title>MLB Replays from Nhon Truong - Config</title>
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
        <h2>⚾ MLB Replays from Nhon Truong</h2>
        <p>Chọn các đội bóng m muốn theo dõi (Mỗi đội sẽ tạo thành 1 Season trong Nuvio):</p>
        <form id="configForm">
          <div style="max-height: 300px; overflow-y: auto; background: #252525; padding: 10px; border-radius: 5px;">
            ${teamCheckboxes}
          </div>
          <button type="button" onclick="generateLink()">Tạo Link Cài Đặt Nuvio</button>
        </form>
        <div id="result" class="output">
          <p style="margin: 0 0 5px 0; color: #aaa;">Copy link bên dưới dán vào Nuvio:</p>
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

// 2. Manifest Endpoint
app.get(['/manifest.json', '/:config/manifest.json'], (req, res) => {
  const config = parseConfig(req.params.config);
  let nameExtra = '';
  if (config && config.teams && config.teams.length > 0) {
    nameExtra = ` (${config.teams.length} đội)`;
  }

  res.json({
    id: 'org.mlblive.gmt7.nhontruong.addon',
    version: '1.4.0',
    name: `MLB Replays from Nhon Truong${nameExtra}`,
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

// 3. Catalog Endpoint (Chỉ trả về ĐÚNG 1 THẺ HUB tĩnh - Tốc độ siêu nhanh, không bao giờ lỗi)
app.get(['/catalog/*', '/:config/catalog/*'], (req, res) => {
  res.json({
    metas: [
      {
        id: 'mlb_replays_hub',
        type: 'series',
        name: '⚾ MLB Replays Hub',
        poster: 'https://images.unsplash.com/photo-1508802913283-77c8e63a151b?w=600&auto=format&fit=crop',
        background: 'https://images.unsplash.com/photo-1508802913283-77c8e63a151b?w=1200&auto=format&fit=crop',
        description: 'Bấm vào đây để chọn và xem danh sách các trận đấu Replay theo từng đội bóng.'
      }
    ]
  });
});

// 4. Meta Endpoint (Bấm vào Hub mới bắt đầu cào dữ liệu và phân chia từng Tab đội bóng)
app.get(['/meta/*', '/:config/meta/*'], async (req, res) => {
  try {
    const config = parseConfig(req.params.config);
    const selectedTeams = (config && config.teams) ? config.teams : [];

    console.log(`[META] Đang tải danh sách trận đấu cho Hub... (Đội đã chọn: ${selectedTeams.length})`);

    const { data } = await axios.get('https://mlblive.net/', { headers: HTTP_HEADERS });
    const $ = cheerio.load(data);
    const articles = [];

    $('article, .post, .entry, .item, .card, div[class*="post"]').each((_, el) => {
      const titleEl = $(el).find('h1 a, h2 a, h3 a, .entry-title a, .title a').first();
      const aTag = titleEl.length ? titleEl : $(el).find('a').first();
      
      const href = aTag.attr('href');
      let title = aTag.attr('title') || aTag.text().trim() || $(el).find('h1, h2, h3, .title').text().trim();
      title = title.replace(/\s+/g, ' ').trim();

      let img = $(el).find('img').attr('data-lazy-src') || 
                $(el).find('img').attr('data-src') || 
                $(el).find('img').attr('data-original') || 
                $(el).find('img').attr('src');

      if (title && href) {
        const dateMatch = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i);
        let dateVNText = 'Không rõ ngày';
        let dateISO = new Date().toISOString();
        if (dateMatch) {
          const parsedDate = dayjs.tz(dateMatch[0], 'MMMM D, YYYY', 'America/New_York');
          if (parsedDate.isValid()) {
            dateVNText = parsedDate.tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY');
            dateISO = parsedDate.toISOString();
          }
        }

        if (img && !img.startsWith('http')) img = `https://mlblive.net${img}`;

        articles.push({
          id: Buffer.from(href).toString('base64'),
          title,
          href,
          img: img || '',
          dateVNText,
          dateISO
        });
      }
    });

    const videos = [];
    let seasonLegend = '';

    if (selectedTeams.length > 0) {
      // Phân chia trận đấu theo từng Season (mỗi đội là 1 Season)
      seasonLegend = selectedTeams.map((team, idx) => `• Season ${idx + 1}: ${team}`).join('\n');

      selectedTeams.forEach((teamName, teamIdx) => {
        const seasonNum = teamIdx + 1;
        let epNum = 1;
        const keywords = TEAM_KEYWORDS[teamName] || [teamName.toLowerCase()];

        articles.forEach(art => {
          const titleLower = art.title.toLowerCase();
          const isMatch = keywords.some(kw => titleLower.includes(kw));
          if (isMatch) {
            videos.push({
              id: art.id,
              title: art.title,
              season: seasonNum,
              episode: epNum++,
              released: art.dateISO,
              thumbnail: art.img,
              overview: `📅 Ngày đấu (Giờ VN): ${art.dateVNText}\nĐội: ${teamName}`
            });
          }
        });
      });
    } else {
      // Nếu không chọn đội nào, gom tất cả vào Season 1
      seasonLegend = '• Season 1: Tất cả các trận mới nhất';
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
        poster: 'https://images.unsplash.com/photo-1508802913283-77c8e63a151b?w=600&auto=format&fit=crop',
        background: 'https://images.unsplash.com/photo-1508802913283-77c8e63a151b?w=1200&auto=format&fit=crop',
        description: `Danh sách các đội bóng tương ứng với từng Season:\n${seasonLegend}`,
        videos: videos
      }
    });
  } catch (err) {
    console.error('[META ERROR]:', err.message);
    res.json({ meta: { id: 'mlb_replays_hub', type: 'series', name: '⚾ MLB Replays Hub', videos: [] } });
  }
});

// 5. Stream Endpoint (Lấy link xem video)
app.get(['/stream/*', '/:config/stream/*'], async (req, res) => {
  try {
    const fullPath = req.path;
    const parts = fullPath.split('/');
    const rawFilename = parts[parts.length - 1];
    const rawId = rawFilename.replace('.json', '');

    const targetUrl = Buffer.from(rawId, 'base64').toString('utf-8');

    const { data } = await axios.get(targetUrl, { headers: HTTP_HEADERS });
    const $ = cheerio.load(data);
    const streams = [];

    $('iframe').each((index, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;

        let serverName = `Server #${index + 1}`;
        if (src.includes('mail.ru')) serverName = `Server Mail.Ru #${index + 1}`;
        if (src.includes('ok.ru')) serverName = `Server OK.Ru #${index + 1}`;

        streams.push({
          title: serverName,
          url: src,
          behaviorHints: {
            requestHeaders: { 'Referer': targetUrl }
          }
        });
      }
    });

    res.json({ streams });
  } catch (err) {
    console.error('[STREAM ERROR]:', err.message);
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`MLB Replays Addon running at http://localhost:${PORT}`));
