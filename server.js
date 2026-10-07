const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

const app = express();
app.use(cors());

// Tắt Cache phía Client/Proxy để Stremio/Nuvio luôn nhận link mới
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(__dirname));

const DODGERS_URL = 'https://mlblive.net/los-angeles-dodgers-full-game-replay';

// Key ScrapingAnt & URL Cloudflare Worker (Lấy từ Environment Variables hoặc điền trực tiếp)
const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || 'dien_scrapingant_key_o_day';
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://link-worker-cloudflare-cua-m.workers.dev';

// ----------------------------------------------------
// 🧠 BỘ NHỚ CACHE TRONG RAM
// ----------------------------------------------------
let articlesCache = [];             // Lưu danh sách bài viết/trận đấu
let okRuStreamsCache = new Map();   // Lưu link MP4 direct của từng trận

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

function parseReleaseDate(title) {
  try {
    const match = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i);
    if (match) {
      const parsedDate = new Date(match[0]);
      if (!isNaN(parsedDate.getTime())) return parsedDate.toISOString();
    }
  } catch (e) {}
  return new Date().toISOString();
}

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://mlblive.net/'
};

// ⚡ HÀM FETCH (SCRAPINGANT -> AXIOS DIRECT FALLBACK)
async function fetchWithFallback(targetUrl) {
  try {
    if (SCRAPINGANT_API_KEY && SCRAPINGANT_API_KEY !== 'dien_scrapingant_key_o_day') {
      console.log(` 🚀 [SCRAPINGANT] Fetching: ${targetUrl}`);
      const antUrl = `https://api.scrapingant.com/v2/general?x-api-key=${SCRAPINGANT_API_KEY}&url=${encodeURIComponent(targetUrl)}&browser=true`;
      const { data } = await axios.get(antUrl, { timeout: 15000 });
      console.log(` ✅ [SCRAPINGANT SUCCESS]`);
      return data;
    }
  } catch (err) {
    console.error(` ⚠️ [SCRAPINGANT FAIL]: ${err.message}`);
  }

  console.log(` ⚠️ [FALLBACK DIRECT] Gọi trực tiếp Axios...`);
  const { data } = await axios.get(targetUrl, { headers: HTTP_HEADERS, timeout: 10000 });
  return data;
}

// BÓC TÁCH LINK OK.RU ĐỂ LẤY LINK DIRECT MP4 / HLS (Nâng cấp v5.3.1 - Chống xịt)
async function getOkRuDirectUrl(embedUrl) {
  try {
    let targetUrl = embedUrl;
    if (targetUrl.includes('ok.ru/video/')) {
      targetUrl = targetUrl.replace('ok.ru/video/', 'ok.ru/videoembed/');
    }

    const data = await fetchWithFallback(targetUrl);
    if (!data) return null;

    const $ = cheerio.load(data);
    let metadata = null;

    // Cách 1: Tìm trong data-options của div OKVideo
    let dataOptions = $('div[data-module="OKVideo"]').attr('data-options') \vert{}\vert{} $('div[data-options]').attr('data-options');
    
    if (dataOptions) {
      try {
        const options = JSON.parse(dataOptions);
        const metadataStr = options.flashvars ? options.flashvars.metadata : options.metadata;
        if (metadataStr) {
          metadata = typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr;
        }
      } catch (e) {
        console.error(' ⚠️ Lỗi parse JSON data-options:', e.message);
      }
    }

    // Cách 2: Nếu không thấy data-options, quét Regex trong thẻ <script>
    if (!metadata) {
      const htmlText = $.html();
      const metadataMatch = htmlText.match(/\"metadata\"\s*:\s*(\"{.*?}\"|{.*?})/s);
      if (metadataMatch && metadataMatch[1]) {
        try {
          let rawMeta = metadataMatch[1];
          if (rawMeta.startsWith('"') && rawMeta.endsWith('"')) {
            rawMeta = JSON.parse(rawMeta);
          }
          metadata = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
        } catch (e) {
          console.error(' ⚠️ Lỗi parse Regex script metadata:', e.message);
        }
      }
    }

    // Trích xuất link từ Metadata
    if (metadata) {
      // 1. Ưu tiên lấy MP4 direct chất lượng cao nhất
      if (metadata.videos && metadata.videos.length > 0) {
        const mp4Videos = metadata.videos.filter(v => v.url && v.url.startsWith('http') && !v.url.includes('.m3u8'));
        if (mp4Videos.length > 0) {
          const bestMp4 = mp4Videos[mp4Videos.length - 1];
          const videoName = bestMp4.name ? bestMp4.name.toUpperCase() : 'HD';
          console.log(` ⚡ [PARSER OK.RU SUCCESS] MP4 (${videoName}): ${bestMp4.url}`);
          return bestMp4.url;
        }
      }

      // 2. Fallback sang HLS Manifest (.m3u8) nếu không có MP4 direct
      if (metadata.hlsManifestUrl) {
        console.log(` ⚡ [PARSER OK.RU SUCCESS] Fallback HLS (m3u8): ${metadata.hlsManifestUrl}`);
        return metadata.hlsManifestUrl;
      }
    } else {
      console.warn(` ⚠️ [PARSER OK.RU WARNING] Không tìm thấy metadata trong HTML: ${targetUrl}`);
    }
  } catch (err) {
    console.error(`⚠️ [PARSER OK.RU FAIL]:`, err.message);
  }
  return null;
}

// CÀO DANH SÁCH BÀI VIẾT (CÓ CACHE RAM)
async function fetchDodgersArticles(forceRefresh = false) {
  if (!forceRefresh && articlesCache.length > 0) {
    console.log(`📦 [CACHE HIT] Lấy danh sách từ RAM Cache (${articlesCache.length} trận).`);
    return articlesCache;
  }

  try {
    console.log(`\n========================================`);
    console.log(`[SCRAPE REFRESH] Đang cào dữ liệu mới từ:\n${DODGERS_URL}`);
    
    const data = await fetchWithFallback(DODGERS_URL);
    const $ = cheerio.load(data);
    const articles = [];
    const seenHrefs = new Set();

    $('a').each((_, el) => {
      let href = $(el).attr('href');
      let textVal = $(el).text();
      let titleVal = $(el).attr('title');
      let altVal = $(el).find('img').attr('alt');
      
      let rawTitle = textVal ? textVal : (titleVal ? titleVal : (altVal ? altVal : ''));
      let title = rawTitle.replace(/\s+/g, ' ').trim();

      if (!href) return;
      if (!title) return;
      if (title.length < 10) return;
      
      if (href.startsWith('/')) href = `https://mlblive.net${href}`;

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
      let lazySrc = parent.find('img').attr('data-lazy-src');
      let dataSrc = parent.find('img').attr('data-src');
      let normalSrc = parent.find('img').attr('src');
      
      let img = lazySrc ? lazySrc : (dataSrc ? dataSrc : (normalSrc ? normalSrc : ''));
      if (img && img.startsWith('/')) img = `https://mlblive.net${img}`;

      seenHrefs.add(href);
      articles.push({ title, href, img });
    });

    if (articles.length > 0) {
      articlesCache = articles;
      console.log(`[SCRAPE SUCCESS] Đã cào và lưu Cache ${articles.length} trận đấu.`);
    }
    console.log(`========================================\n`);
    return articlesCache;
  } catch (err) {
    console.error(`❌ [SCRAPE ERROR]:`, err.message);
    return articlesCache;
  }
}

// ----------------------------------------------------
// ⏰ TỰ ĐỘNG CÀO & RESET CACHE LÚC 17:30 GIỜ VIỆT NAM
// ----------------------------------------------------
cron.schedule('30 17 * * *', async () => {
  console.log(`\n⏰ [CRONJOB 17:30 VN] Reset cache & cào danh sách trận đấu mới...`);
  articlesCache = [];           
  okRuStreamsCache.clear();    
  await fetchDodgersArticles(true);
}, {
  scheduled: true,
  timezone: "Asia/Ho_Chi_Minh"
});

// 0. Landing Page (UptimeRobot ping mỗi 5 phút)
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
        <div class="status">● ONLINE (v5.3.1 - Enhanced Parser)</div>
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
    version: '5.3.1',
    name: 'Dodgers Replays',
    description: 'Tổng hợp toàn bộ trận đấu Replay của Los Angeles Dodgers',
    resources: [
      'catalog',
      { name: 'meta', types: ['series'], idPrefixes: ['dodgers_main'] },
      { name: 'stream', types: ['series'], idPrefixes: ['dodgers_main'] }
    ],
    types: ['series'],
    catalogs: [{ type: 'series', id: 'dodgers_catalog', name: 'Dodgers Replays' }]
  });
});

// 2. Catalog Endpoint
app.get('/catalog/*', (req, res) => {
  const posterUrl = getPosterUrl(req);
  res.json({
    metas: [{
      id: 'dodgers_main',
      type: 'series',
      name: '⚾ Los Angeles Dodgers Replays',
      poster: posterUrl,
      background: posterUrl,
      description: 'Xem lại các trận đấu mới nhất của Los Angeles Dodgers'
    }]
  });
});

// 3. Meta Endpoint
app.get('/meta/*', async (req, res) => {
  try {
    const posterUrl = getPosterUrl(req);
    const articles = await fetchDodgersArticles();
    const videos = articles.map((art, index) => ({
      id: `dodgers_main:1:${index + 1}`,
      title: art.title,
      season: 1,
      episode: index + 1,
      released: parseReleaseDate(art.title),
      thumbnail: art.img,
      overview: art.title
    }));

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
    res.json({ meta: { id: 'dodgers_main', type: 'series', name: 'Dodgers Replays', videos: [] } });
  }
});

// 4. Stream Endpoint
app.get('/stream/*', async (req, res) => {
  try {
    const cleanId = extractCleanId(req);
    const parts = cleanId.split(':');
    const epNum = parseInt(parts[2], 10);

    const articles = await fetchDodgersArticles();
    const targetArticle = articles[epNum - 1];

    if (!targetArticle || !targetArticle.href) {
      return res.json({ streams: [] });
    }

    console.log(`\n========================================`);
    console.log(`[STREAM REQUEST] Tập #${epNum} (${targetArticle.title})`);

    // Kiểm tra Cache Stream
    if (okRuStreamsCache.has(targetArticle.href)) {
      console.log(` 📦 [CACHE HIT STREAM] Lấy link stream từ RAM Cache.`);
      const cachedStreams = okRuStreamsCache.get(targetArticle.href);
      return res.json({ streams: cachedStreams });
    }

    console.log(` 🚀 [SCRAPE STREAM] Bắt đầu check link OK.ru...`);
    const data = await fetchWithFallback(targetArticle.href);
    const $ = cheerio.load(data);
    const streams = [];
    const iframeElements = $('iframe').toArray();

    for (let index = 0; index < iframeElements.length; index++) {
      const el = iframeElements[index];
      let srcAttr = $(el).attr('src');
      let dataSrcAttr = $(el).attr('data-src');
      let lazySrcAttr = $(el).attr('data-lazy-src');
      
      let src = srcAttr ? srcAttr : (dataSrcAttr ? dataSrcAttr : lazySrcAttr);
      
      if (!src) continue;
      if (src.startsWith('//')) src = 'https:' + src;

      let streamUrl = src;
      let serverName = `Server #${index + 1}`;

      if (src.includes('ok.ru')) {
        serverName = `⚡ OK.ru Fast Direct #${index + 1}`;
        const directMediaUrl = await getOkRuDirectUrl(src);
        
        if (directMediaUrl) {
          // Gửi link qua Cloudflare Worker Proxy
          streamUrl = `${CF_WORKER_URL}?url=${encodeURIComponent(directMediaUrl)}`;
          console.log(` ➔ [USING CLOUDFLARE WORKER PROXY]: ${streamUrl}`);
        } else {
          // Fallback sang link Embed iframe nếu không bóc được MP4
          console.log(` ⚠️ [FALLBACK EMBED]: Dùng link embed iframe gốc của OK.ru.`);
          streamUrl = src.includes('ok.ru/video/') ? src.replace('ok.ru/video/', 'ok.ru/videoembed/') : src;
        }
      }

      streams.push({
        title: serverName,
        url: streamUrl,
        behaviorHints: {
          notSupported: false
        }
      });
    }

    if (streams.length > 0) {
      okRuStreamsCache.set(targetArticle.href, streams);
      console.log(` 💾 [CACHE STORED] Đã lưu link stream trận này vào Cache.`);
    }

    console.log(`[STREAM SUCCESS] Trả về ${streams.length} luồng stream.`);
    console.log(`========================================\n`);

    res.json({ streams });
  } catch (err) {
    console.error('❌ [STREAM ERROR]:', err.message);
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, async () => {
  console.log(`Dodgers Replays Addon v5.3.1 running at port ${PORT}`);
  console.log(`🚀 [SERVER STARTUP] Đang khởi tạo Cache ban đầu...`);
  await fetchDodgersArticles(true);
});
