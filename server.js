const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// Tắt hoàn toàn Cache phía Client/Proxy
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(__dirname));

const DODGERS_URL = 'https://mlblive.net/los-angeles-dodgers-full-game-replay';

function getPosterUrl(req) {
  return `${req.protocol}://${req.get('host')}/poster.jpg`;
}

function extractCleanId(req) {
  const rawPath = req.path;
  const filename = rawPath.split('/').pop().replace('.json', '');
  try {
    return decodeURIComponent(filename);
  } catch (e) {
    return filename;
  }
}

// Trích xuất ngày từ tiêu đề trận đấu
function parseReleaseDate(title) {
  try {
    const match = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i);
    if (match) {
      const parsedDate = new Date(match[0]);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.toISOString();
      }
    }
  } catch (e) {}
  return new Date().toISOString();
}

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://mlblive.net/'
};

// HÀM BÓC TÁCH LINK VIDEO TRỰC TIẾP (.m3u8 / .mp4) TỪ OK.RU
async function getOkRuDirectUrl(embedUrl) {
  try {
    const { data } = await axios.get(embedUrl, { headers: HTTP_HEADERS, timeout: 5000 });
    const $ = cheerio.load(data);
    
    // OK.ru giấu config trong attribute data-options
    const dataOptions = $('div[data-module="OKVideo"]').attr('data-options') || $('div[data-options]').attr('data-options');
    
    if (dataOptions) {
      const options = JSON.parse(dataOptions);
      const metadataStr = options.flashvars ? options.flashvars.metadata : options.metadata;
      
      if (metadataStr) {
        const metadata = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
        
        // Ưu tiên 1: Lấy link HLS (.m3u8) để stream mượt nhất
        if (metadata.hlsManifestUrl) {
          console.log(`   ⚡ [PARSER OK.RU] Lấy thành công link HLS (.m3u8)`);
          return metadata.hlsManifestUrl;
        }
        
        // Ưu tiên 2: Lấy link MP4 chất lượng cao nhất
        if (metadata.videos && metadata.videos.length > 0) {
          const bestVideo = metadata.videos[metadata.videos.length - 1]; // Phần tử cuối thường là chất lượng cao nhất (1080p/720p)
          console.log(`   ⚡ [PARSER OK.RU] Lấy thành công link MP4 (${bestVideo.name})`);
          return bestVideo.url;
        }
      }
    }
  } catch (err) {
    console.error(`   ⚠️ [PARSER OK.RU FAIL] Không parse được direct link, dùng link gốc embed:`, err.message);
  }
  return embedUrl; // Fallback nếu parse lỗi
}

async function fetchDodgersArticles() {
  try {
    console.log(`\n========================================`);
    console.log(`[SCRAPE REFRESH] Đang cào danh sách mới nhất từ:\n${DODGERS_URL}`);
    
    const { data } = await axios.get(DODGERS_URL, { headers: HTTP_HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);
    const articles = [];
    const seenHrefs = new Set();

    $('a').each((_, el) => {
      let href = $(el).attr('href');
      let rawTitle = $(el).text() || $(el).attr('title') || $(el).find('img').attr('alt') || '';
      let title = rawTitle.replace(/\s+/g, ' ').trim();

      if (!href || !title || title.length < 10) return;

      if (href.startsWith('/')) {
        href = `https://mlblive.net${href}`;
      }

      const cleanHref = href.replace(/\/$/, '');
      const urlSlug = cleanHref.split('/').pop().toLowerCase();
      const lowerHref = href.toLowerCase();

      if (!lowerHref.includes('dodgers')) return;
      if (!lowerHref.includes('full-game-replay')) return;
      if (urlSlug.endsWith('mlb')) return;
      if (urlSlug === 'los-angeles-dodgers-full-game-replay') return;
      if (lowerHref.includes('/category/') || lowerHref.includes('/page/') || lowerHref.includes('/tag/')) return;

      if (seenHrefs.has(href)) return;

      const parent = $(el).closest('div, li, td, article, tr');
      let img = parent.find('img').attr('data-lazy-src') || 
                parent.find('img').attr('data-src') || 
                parent.find('img').attr('src') || '';
      if (img && img.startsWith('/')) img = `https://mlblive.net${img}`;

      seenHrefs.add(href);
      articles.push({ title, href, img });
    });

    console.log(`[SCRAPE SUCCESS] Cào thành công ${articles.length} trận đấu Dodgers:`);
    articles.forEach((art, index) => {
      console.log(`   ${index + 1}. [${art.title}] -> ${art.href}`);
    });
    console.log(`========================================\n`);

    return articles;
  } catch (err) {
    console.error(`❌ [SCRAPE ERROR]:`, err.message);
    return [];
  }
}

// 0. Landing Page
app.get(['/', '/configure'], (req, res) => {
  const manifestUrl = `${req.protocol}://${req.get('host')}/manifest.json`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Dodgers Replays Addon</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #121212; color: #fff; max-width: 500px; margin: 40px auto; text-align: center; }
        .card { background: #1e1e1e; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid #333; }
        h2 { color: #00d2ff; margin-top: 0; }
        .status { display: inline-block; padding: 5px 12px; background: #00e676; color: #000; font-weight: bold; border-radius: 20px; font-size: 0.85em; margin-bottom: 15px; }
        input { width: 100%; padding: 10px; border-radius: 5px; border: 1px solid #444; background: #2a2a2a; color: #00f0ff; text-align: center; font-size: 0.9em; box-sizing: border-box; margin: 10px 0; }
        button { background: #00d2ff; color: #000; border: none; padding: 10px 20px; font-weight: bold; border-radius: 5px; cursor: pointer; width: 100%; }
        button:hover { background: #0099cc; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>⚾ Dodgers Replays Addon</h2>
        <div class="status">● ONLINE</div>
        <p style="color: #ccc; font-size: 0.95em;">Addon tổng hợp các trận đấu Replay của Los Angeles Dodgers cho Stremio / Nuvio.</p>
        <p style="margin-top: 20px; text-align: left; color: #aaa; font-size: 0.85em;">Link Manifest cài đặt:</p>
        <input type="text" id="link" value="${manifestUrl}" readonly>
        <button onclick="copyLink()">Copy Link Manifest</button>
      </div>
      <script>
        function copyLink() {
          const input = document.getElementById('link');
          input.select();
          document.execCommand('copy');
          alert('Đã copy link Manifest!');
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// 1. Manifest Endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'org.dodgersreplays.gmt7.nhontruong.addon',
    version: '3.6.0',
    name: 'Dodgers Replays',
    description: 'Tổng hợp toàn bộ trận đấu Replay của Los Angeles Dodgers',
    resources: [
      'catalog',
      { name: 'meta', types: ['series'], idPrefixes: ['dodgers_main'] },
      { name: 'stream', types: ['series'], idPrefixes: ['dodgers_main'] }
    ],
    types: ['series'],
    catalogs: [
      {
        type: 'series',
        id: 'dodgers_catalog',
        name: 'Dodgers Replays'
      }
    ]
  });
});

// 2. Catalog Endpoint
app.get('/catalog/*', (req, res) => {
  const posterUrl = getPosterUrl(req);
  res.json({
    metas: [
      {
        id: 'dodgers_main',
        type: 'series',
        name: '⚾ Los Angeles Dodgers Replays',
        poster: posterUrl,
        background: posterUrl,
        description: 'Xem lại các trận đấu mới nhất của Los Angeles Dodgers'
      }
    ]
  });
});

// 3. Meta Endpoint
app.get('/meta/*', async (req, res) => {
  try {
    const posterUrl = getPosterUrl(req);
    const articles = await fetchDodgersArticles();
    const videos = [];

    articles.forEach((art, index) => {
      const epNum = index + 1;
      const releaseDate = parseReleaseDate(art.title);

      videos.push({
        id: `dodgers_main:1:${epNum}`,
        title: art.title,
        season: 1,
        episode: epNum,
        released: releaseDate,
        thumbnail: art.img,
        overview: art.title
      });
    });

    console.log(`[META REQUEST] Trả về ${videos.length} trận đấu mới nhất cho Nuvio!`);

    res.json({
      meta: {
        id: 'dodgers_main',
        type: 'series',
        name: '⚾ Los Angeles Dodgers Replays',
        poster: posterUrl,
        background: posterUrl,
        description: 'Tổng hợp toàn bộ các trận Replay của Los Angeles Dodgers',
        videos: videos
      }
    });
  } catch (err) {
    console.error('❌ [META ERROR]:', err.message);
    res.json({ meta: { id: 'dodgers_main', type: 'series', name: 'Dodgers Replays', videos: [] } });
  }
});

// 4. Stream Endpoint (Giải mã trực tiếp stream từ OK.ru)
app.get('/stream/*', async (req, res) => {
  try {
    const cleanId = extractCleanId(req);
    const parts = cleanId.split(':');
    const epNum = parseInt(parts[2], 10);

    const articles = await fetchDodgersArticles();
    const targetArticle = articles[epNum - 1];

    if (!targetArticle || !targetArticle.href) {
      console.log(`❌ [STREAM ERROR] Không tìm thấy bài viết cho tập #${epNum}`);
      return res.json({ streams: [] });
    }

    console.log(`\n========================================`);
    console.log(`[STREAM REQUEST] Lấy video tập #${epNum} (${targetArticle.title})\nBài viết URL: ${targetArticle.href}`);

    const { data } = await axios.get(targetArticle.href, { headers: HTTP_HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);
    const iframeUrls = [];

    $('iframe').each((_, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        iframeUrls.push(src);
      }
    });

    const streams = [];

    // Xử lý bóc tách từng iframe để lấy direct link
    for (let index = 0; index < iframeUrls.length; index++) {
      let src = iframeUrls[index];
      let serverName = `Server #${index + 1}`;

      if (src.includes('ok.ru')) {
        serverName = `⚡ OK.ru Fast Direct #${index + 1}`;
        // Gọi hàm bóc tách link video thực sự từ OK.ru
        src = await getOkRuDirectUrl(src);
      } else if (src.includes('mail.ru')) {
        serverName = `⚾ Mail.ru #${index + 1}`;
      }

      streams.push({
        title: serverName,
        url: src,
        behaviorHints: {
          requestHeaders: { 
            'User-Agent': HTTP_HEADERS['User-Agent'],
            'Referer': 'https://ok.ru/'
          }
        }
      });

      console.log(` ➔ [DIRECT STREAM #${index + 1}] (${serverName}): ${src}`);
    }

    console.log(`[STREAM SUCCESS] Trả về ${streams.length} luồng stream trực tiếp.`);
    console.log(`========================================\n`);

    res.json({ streams });
  } catch (err) {
    console.error('❌ [STREAM ERROR]:', err.message);
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Dodgers Replays Addon v3.6.0 running at http://localhost:${PORT}`));
