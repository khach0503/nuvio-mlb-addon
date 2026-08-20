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

// Danh sách 30 đội MLB để hiển thị trên giao diện Config
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

// 1. Giao diện Cấu hình (Config UI)
app.get(['/', '/configure'], (req, res) => {
  const teamCheckboxes = MLB_TEAMS.map(team => `
    <label style="display: inline-block; width: 45%; margin: 5px 2%;">
      <input type="checkbox" name="teams" value="${team}"> ${team}
    </label>
  `).join('');

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
        <p>Tích chọn các đội bóng bạn muốn xem (Nếu không chọn đội nào, addon sẽ hiển thị tất cả các trận):</p>
        <form id="configForm">
          <div style="max-height: 300px; overflow-y: auto; background: #252525; padding: 10px; border-radius: 5px;">
            ${teamCheckboxes}
          </div>
          <button type="button" onclick="generateLink()">Tạo Link Cài Đặt Nuvio</button>
        </form>
        <div id="result" class="output">
          <p style="margin: 0 0 5px 0; color: #aaa;">Copy link bên dưới và dán vào phần Addons của Nuvio:</p>
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

// Helper phân tích cấu hình từ URL
function parseConfig(configStr) {
  if (!configStr) return null;
  try {
    return JSON.parse(decodeURIComponent(configStr));
  } catch (e) {
    return null;
  }
}

// 2. Dynamic Manifest Endpoint (Đã đổi types sang 'series' để hiện ở Home Screen)
app.get(['/manifest.json', '/:config/manifest.json'], (req, res) => {
  const config = parseConfig(req.params.config);
  let nameExtra = '';
  if (config && config.teams && config.teams.length > 0) {
    nameExtra = ` (${config.teams.length} đội)`;
  }

  res.json({
    id: 'org.mlblive.gmt7.nhontruong.addon',
    version: '1.2.0',
    name: `MLB Replays from Nhon Truong${nameExtra}`,
    description: 'Replay MLB cập nhật realtime theo giờ Việt Nam (GMT+7) và lọc theo đội bóng chọn lọc',
    behaviorHints: { configurable: true, configurationRequired: false },
    resources: ['catalog', 'stream'],
    types: ['series', 'movie'],
    catalogs: [
      {
        type: 'series',
        id: 'mlblive_catalog',
        name: 'MLB Replays'
      }
    ]
  });
});

// 3. Dynamic Catalog Endpoint
app.get(['/catalog/:type/:id.json', '/:config/catalog/:type/:id.json'], async (req, res) => {
  try {
    const config = parseConfig(req.params.config);
    const selectedTeams = (config && config.teams) ? config.teams : [];
    const itemType = req.params.type || 'series';

    const { data } = await axios.get('https://mlblive.net/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const $ = cheerio.load(data);
    const metas = [];

    $('article, .post, .item').each((_, el) => {
      const aTag = $(el).find('a').first();
      const title = aTag.attr('title') || $(el).find('.title, h2').text().trim();
      const href = aTag.attr('href');
      let img = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

      if (title && href) {
        if (selectedTeams.length > 0) {
          const matchTeam = selectedTeams.some(team => title.toLowerCase().includes(team.toLowerCase()));
          if (!matchTeam) return;
        }

        const dateMatch = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i);
        let dateVNText = 'Không rõ ngày';
        if (dateMatch) {
          const parsedDate = dayjs.tz(dateMatch[0], 'MMMM D, YYYY', 'America/New_York');
          dateVNText = parsedDate.tz('Asia/Ho_Chi_Minh').format('DD/MM/YYYY');
        }

        if (img && !img.startsWith('http')) {
          img = `https://mlblive.net${img}`;
        }

        const id = Buffer.from(href).toString('base64');

        metas.push({
          id: id,
          type: itemType,
          name: title,
          poster: img || '',
          description: `📅 Ngày đấu (Giờ VN): ${dateVNText}\nNguồn: mlblive.net | Addon by Nhon Truong`
        });
      }
    });

    res.json({ metas });
  } catch (err) {
    console.error('Lỗi Catalog:', err.message);
    res.json({ metas: [] });
  }
});

// 4. Dynamic Stream Endpoint
app.get(['/stream/:type/:id.json', '/:config/stream/:type/:id.json'], async (req, res) => {
  try {
    const rawId = req.params.id.replace('.json', '');
    const targetUrl = Buffer.from(rawId, 'base64').toString('utf-8');

    const { data } = await axios.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const $ = cheerio.load(data);
    const streams = [];

    $('iframe').each((index, el) => {
      let src = $(el).attr('src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;

        let serverName = `Server ${index + 1}`;
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
    console.error('Lỗi Stream:', err.message);
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`MLB Replays Addon running at http://localhost:${PORT}`));
