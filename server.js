const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

// Tắt Cache client để Nuvio luôn nhận danh sách mới nhất
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(__dirname));

const DODGERS_URL = 'https://mlblive.net/los-angeles-dodgers-full-game-replay';
let articlesCache = { data: [], lastFetch: 0 };
const CACHE_DURATION = 10 * 60 * 1000; // Cache 10 phút

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

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Referer': 'https://mlblive.net/'
};

async function fetchDodgersArticles() {
  const now = Date.now();
  if (articlesCache.data.length > 0 && (now - articlesCache.lastFetch) < CACHE_DURATION) {
    return articlesCache.data;
  }

  try {
    console.log(`\n========================================`);
    console.log(`[SCRAPE START] Đang cào danh sách trận đấu Dodgers từ:\n${DODGERS_URL}`);
    
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
      const urlSlug = cleanHref.split('/').pop();

      // BỘ LỌC CHỈ LẤY BÀI VIẾT TRẬN ĐẤU:
      // 1. URL phải chứa 'mlb-full-game-replay' hoặc 'full-game-replay'
      if (!href.includes('full-game-replay')) return;

      // 2. LOẠI BỎ chính trang danh mục Dodgers
      if (urlSlug === 'los-angeles-dodgers-full-game-replay') return;

      // 3. LOẠI BỎ phân trang, category, tag
      if (href.includes('/category/') || href.includes('/page/') || href.includes('/tag/')) return;

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

    articlesCache = { data: articles, lastFetch: now };
    return articles;
  } catch (err) {
    console.error(`❌ [SCRAPE ERROR]:`, err.message);
    return articlesCache.data;
  }
}

// 1. Manifest Endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'org.dodgersreplays.gmt7.nhontruong.addon',
    version: '3.0.0',
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
  
  // Trả về 1 Series duy nhất là "Los Angeles Dodgers Replays"
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

  // Trigger cào dữ liệu sẵn
  fetchDodgersArticles().catch(() => {});
});

// 3. Meta Endpoint (Danh sách tập phim / trận đấu)
app.get('/meta/*', async (req, res) => {
  try {
    const posterUrl = getPosterUrl(req);
    const articles = await fetchDodgersArticles();
    const videos = [];

    articles.forEach((art, index) => {
      const epNum = index + 1;
      videos.push({
        id: `dodgers_main:1:${epNum}`,
        title: art.title,
        season: 1,
        episode: epNum,
        released: '2020-01-01T00:00:00.000Z', // Ép Nuvio hiện đầy đủ không bị ẩn
        thumbnail: art.img,
        overview: art.title
      });
    });

    console.log(`[META REQUEST] Trả về ${videos.length} trận đấu Dodgers cho Nuvio!`);

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

// 4. Stream Endpoint (Lấy link video stream)
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
    console.log(`[STREAM REQUEST] Lấy video tập #${epNum} (${targetArticle.title})\nURL: ${targetArticle.href}`);

    const { data } = await axios.get(targetArticle.href, { headers: HTTP_HEADERS, timeout: 8000 });
    const $ = cheerio.load(data);
    const streams = [];

    $('iframe').each((index, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
      
      if (src) {
        if (src.startsWith('//')) {
          src = 'https:' + src;
        }

        let serverName = `Server #${index + 1}`;
        if (src.includes('ok.ru')) {
          serverName = `⚾ OK.ru Direct #${index + 1}`;
        } else if (src.includes('mail.ru')) {
          serverName = `⚾ Mail.ru Direct #${index + 1}`;
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

    console.log(`[STREAM SUCCESS] Tìm thấy ${streams.length} luồng stream.`);
    console.log(`========================================\n`);

    res.json({ streams });
  } catch (err) {
    console.error('❌ [STREAM ERROR]:', err.message);
    res.json({ streams: [] });
  }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Dodgers Replays Addon v3.0.0 running at http://localhost:${PORT}`));
