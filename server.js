require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_KEY;
const SITE_NAME = process.env.SITE_NAME || 'CineFree';
const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

if (!TMDB_KEY) {
  console.error('Missing TMDB_KEY in .env');
  process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  res.locals.siteName = SITE_NAME;
  res.locals.img = (p, size = 'w500') => (p ? `${IMG}/${size}${p}` : '/img/no-poster.jpg');
  res.locals.year = (date) => (date ? String(date).slice(0, 4) : '');
  res.locals.path = req.path;
  res.locals.adsterraSocial = process.env.ADSTERRA_SOCIAL || '';
  res.locals.adsterraPopunder = process.env.ADSTERRA_POPUNDER || '';
  res.locals.adsterraKey = process.env.ADSTERRA_KEY || '';
  next();
});

async function tmdb(endpoint, params = {}) {
  const url = new URL(`${TMDB}${endpoint}`);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'en-US');
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const err = new Error(errorData.status_message || `TMDB ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function mapTv(list) {
  return (list || []).map(s => ({
    ...s,
    title: s.name || s.title,
    release_date: s.first_air_date || s.release_date,
    media_type: 'tv'
  }));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86400000);
}

// --- Live Anime (AniList airing schedule, last 24h) ---
function cleanAnimeTitle(title) {
  if (!title) return '';
  return String(title)
    .replace(/\s*[:\-–]\s*season\s*\d+/gi, '')
    .replace(/\s+season\s*\d+/gi, '')
    .replace(/\s+part\s*\d+/gi, '')
    .replace(/\s+cour\s*\d+/gi, '')
    .replace(/\s*\(\d{4}\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSearchVariants(title) {
  const out = [];
  const add = (q) => {
    q = (q || '').trim();
    if (q && q.length >= 2) out.push(q);
  };
  add(title);
  add(cleanAnimeTitle(title));
  // Split on colon / dash subtitles (common for Chinese donghua)
  for (const part of String(title).split(/[:：\-–|]/)) {
    add(part);
    add(cleanAnimeTitle(part));
  }
  // Without punctuation
  add(String(title).replace(/[!:：\-–_'".]/g, ' ').replace(/\s+/g, ' ').trim());
  // Unique preserve order
  const seen = new Set();
  return out.filter(q => {
    const k = q.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function findTmdbTvId(titles) {
  const tried = new Set();
  for (const raw of titles) {
    for (const q of titleSearchVariants(raw)) {
      if (tried.has(q.toLowerCase())) continue;
      tried.add(q.toLowerCase());
      try {
        const found = await tmdb('/search/tv', { query: q, page: 1 });
        const results = found.results || [];
        if (!results.length) {
          const multi = await tmdb('/search/multi', { query: q, page: 1 });
          for (const r of (multi.results || [])) {
            if (r.media_type === 'tv' && r.id) return r.id;
          }
          continue;
        }
        const lower = q.toLowerCase();
        const hit =
          results.find(r => (r.name || '').toLowerCase() === lower) ||
          results.find(r => (r.original_name || '').toLowerCase() === lower) ||
          results.find(r => (r.name || '').toLowerCase().includes(lower.slice(0, Math.min(10, lower.length)))) ||
          results[0];
        if (hit) return hit.id;
      } catch (_) {}
    }
  }
  return null;
}

async function getLiveAnime() {
  const end = Math.floor(Date.now() / 1000);
  const start = end - 24 * 60 * 60;
  const query = `
    query ($start: Int, $end: Int) {
      Page(page: 1, perPage: 20) {
        airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME_DESC) {
          episode
          airingAt
          media {
            id
            idMal
            title { english romaji native }
            coverImage { large extraLarge }
            format
          }
        }
      }
    }
  `;
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { start, end } })
    });
    const data = await res.json();
    const schedules = (data?.data?.Page?.airingSchedules || []).slice(0, 12);
    const mapped = await Promise.all(schedules.map(async (item) => {
      if (!item.media) return null;
      const eng = item.media.title.english || '';
      const rom = item.media.title.romaji || '';
      const nat = item.media.title.native || '';
      const title = eng || rom || nat || 'Anime';
      const tmdbId = await findTmdbTvId([eng, rom, cleanAnimeTitle(eng), cleanAnimeTitle(rom), nat]);
      const minsAgo = Math.max(0, Math.floor((Date.now() - item.airingAt * 1000) / 60000));
      const badge = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`;
      const ep = item.episode || 1;
      let url;
      if (tmdbId) {
        url = `/tv/watch/${tmdbId}?e=${ep}`;
      } else {
        const q = cleanAnimeTitle(title) || title;
        url = `/search?q=${encodeURIComponent(q)}`;
      }
      return {
        id: tmdbId || item.media.id,
        tmdbId,
        anilistId: item.media.id,
        title,
        episode: ep,
        episode_label: `Ep ${ep}`,
        poster: item.media.coverImage?.extraLarge || item.media.coverImage?.large || '',
        poster_path: null,
        badge,
        kind: 'Anime',
        airingAt: item.airingAt,
        url
      };
    }));
    return mapped.filter(Boolean);
  } catch (e) {
    console.error('getLiveAnime', e.message);
    return [];
  }
}

// --- Live K-Drama: recent episode air dates + KR origin ---
async function getLiveKDramas() {
  const today = todayISO();
  const win = daysAgoISO(3);
  try {
    const response = await tmdb('/discover/tv', {
      with_origin_country: 'KR',
      'air_date.gte': win,
      'air_date.lte': today,
      'first_air_date.lte': today,
      sort_by: 'popularity.desc',
      page: 1
    });
    const results = response.results || [];
    const out = [];
    for (const item of results.slice(0, 15)) {
      let last = null;
      try {
        const detail = await tmdb(`/tv/${item.id}`);
        last = detail.last_episode_to_air;
        if (detail.first_air_date && detail.first_air_date > today) continue;
      } catch (_) {}
      const air = last?.air_date || item.first_air_date || today;
      if (air > today) continue;
      const age = daysBetween(air, today);
      if (age > 3) continue;
      const badge = age === 0 ? 'Today' : age === 1 ? 'Yesterday' : `${age}d ago`;
      out.push({
        id: item.id,
        title: item.name || item.original_name,
        episode: last ? last.episode_number : null,
        episode_label: last ? `S${last.season_number}E${last.episode_number}` : 'New',
        poster_path: item.poster_path,
        poster: item.poster_path ? `${IMG}/w342${item.poster_path}` : '',
        badge,
        kind: 'K-Drama',
        url: last
          ? `/tv/watch/${item.id}?s=${last.season_number}&e=${last.episode_number}`
          : `/tv/watch/${item.id}`
      });
      if (out.length >= 12) break;
    }
    return out;
  } catch (e) {
    console.error('getLiveKDramas', e.message);
    return [];
  }
}



/**
 * Latest Releases: currently airing / just released episodes only.
 * Sorted by last episode air date DESC. No future first_air titles.
 */
async function fetchLatestReleases() {
  const today = todayISO();
  const win7 = daysAgoISO(7);
  const win14 = daysAgoISO(14);

  // Shows that had an episode air in the last 14 days (TMDB air_date filter)
  const [aired7, aired14, onAir, airingToday, airingToday2, animeAired, krAired] = await Promise.all([
    tmdb('/discover/tv', {
      'air_date.gte': win7,
      'air_date.lte': today,
      sort_by: 'popularity.desc',
      page: 1,
      include_null_first_air_dates: 'false'
    }).catch(() => ({ results: [] })),
    tmdb('/discover/tv', {
      'air_date.gte': win14,
      'air_date.lte': today,
      sort_by: 'popularity.desc',
      page: 1,
      include_null_first_air_dates: 'false'
    }).catch(() => ({ results: [] })),
    tmdb('/tv/on_the_air', { page: 1 }).catch(() => ({ results: [] })),
    tmdb('/tv/airing_today', { page: 1 }).catch(() => ({ results: [] })),
    tmdb('/tv/airing_today', { page: 2 }).catch(() => ({ results: [] })),
    tmdb('/discover/tv', {
      with_genres: 16,
      'air_date.gte': win14,
      'air_date.lte': today,
      sort_by: 'popularity.desc',
      page: 1
    }).catch(() => ({ results: [] })),
    tmdb('/discover/tv', {
      with_origin_country: 'KR',
      'air_date.gte': win14,
      'air_date.lte': today,
      sort_by: 'popularity.desc',
      page: 1
    }).catch(() => ({ results: [] }))
  ]);

  const byId = new Map();
  for (const pack of [aired7, aired14, onAir, airingToday, airingToday2, animeAired, krAired]) {
    for (const s of (pack.results || [])) {
      if (!byId.has(s.id)) byId.set(s.id, s);
    }
  }

  // Drop obvious future-first-air before detail fetch
  let candidates = [...byId.values()].filter(s => {
    const fad = s.first_air_date || '';
    if (fad && fad > today) return false;
    return true;
  }).slice(0, 36);

  // Enrich with last_episode_to_air
  const details = await Promise.all(
    candidates.map(s =>
      tmdb(`/tv/${s.id}`).catch(() => null)
    )
  );

  const items = [];
  for (const show of details) {
    if (!show || !show.id) continue;
    const fad = show.first_air_date || '';
    if (fad && fad > today) continue;

    const status = (show.status || '').toLowerCase();
    // Skip pure planned/upcoming with no episodes yet
    if (status === 'planned' || status === 'in production') {
      if (!show.last_episode_to_air) continue;
    }

    const last = show.last_episode_to_air;
    if (!last || !last.air_date) continue;
    if (last.air_date > today) continue; // future episode listing

    const age = daysBetween(last.air_date, today);
    if (age < 0 || age > 14) continue;

    // Prefer 7-day window; keep 14-day as secondary
    const origin = (show.origin_country || [])[0] || '';
    const genres = (show.genres || []).map(g => g.id);
    let kind = 'TV';
    if (genres.includes(16)) kind = 'Anime';
    else if (origin === 'KR') kind = 'K-Drama';
    else if (['CN', 'TW', 'TH', 'JP'].includes(origin)) kind = 'Asian';

    items.push({
      id: show.id,
      name: show.name,
      title: show.name,
      poster_path: show.poster_path,
      backdrop_path: show.backdrop_path,
      vote_average: show.vote_average,
      first_air_date: show.first_air_date,
      release_date: last.air_date,
      media_type: 'tv',
      last_episode: {
        season: last.season_number,
        episode: last.episode_number,
        name: last.name,
        air_date: last.air_date
      },
      episode_label: `S${last.season_number}E${last.episode_number}`,
      kind,
      days_ago: age,
      status: show.status
    });
  }

  // Sort: TODAY first, then newest episode date, then rating
  items.sort((a, b) => {
    if (a.days_ago !== b.days_ago) return a.days_ago - b.days_ago;
    if (a.last_episode.air_date !== b.last_episode.air_date) {
      return a.last_episode.air_date < b.last_episode.air_date ? 1 : -1;
    }
    return (b.vote_average || 0) - (a.vote_average || 0);
  });

  const todayItems = items.filter(i => i.days_ago === 0);
  const weekItems = items.filter(i => i.days_ago > 0 && i.days_ago <= 7);
  const twoWeek = items.filter(i => i.days_ago > 7 && i.days_ago <= 14);
  const result = [...todayItems, ...weekItems];
  if (result.length < 10) result.push(...twoWeek);
  return result.slice(0, 18);
}

// Home
app.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const [
      popular,
      trendingAll,
      mostWatched,
      newAnime,
      newKDrama,
      animeTv,
      tvPopular
    ] = await Promise.all([
      tmdb('/movie/popular', { page: 1 }),
      tmdb('/trending/all/day').catch(() => ({ results: [] })),
      tmdb('/tv/top_rated', { page: 1 }).catch(() => ({ results: [] })),
      getLiveAnime(),
      getLiveKDramas(),
      tmdb('/discover/tv', { with_genres: 16, sort_by: 'popularity.desc', page: 1 }),
      tmdb('/tv/popular', { page: 1 })
    ]);

    const featured = (popular.results || []).filter(m => m.backdrop_path).slice(0, 6);

    res.render('index', {
      title: 'Watch Free Movies Online',
      featured,
      popular: popular.results || [],
      trendingAll: (trendingAll.results || []).slice(0, 12),
      popularNow: (popular.results || []).slice(0, 12),
      newAnime: newAnime || [],
      newKDrama: newKDrama || [],
      mostWatched: mapTv(mostWatched.results).slice(0, 12),
      animeTv: mapTv(animeTv.results),
      tvPopular: mapTv(tvPopular.results),
      page,
      totalPages: popular.total_pages || 1,
      liveUpdatedAt: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

// JSON live feed for optional client refresh
app.get('/api/live', async (req, res) => {
  try {
    const [newAnime, newKDrama] = await Promise.all([getLiveAnime(), getLiveKDramas()]);
    res.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      newAnime,
      newKDrama
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// Search
app.get('/search', async (req, res, next) => {
  const q = (req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  if (!q) return res.redirect('/');
  try {
    const variants = typeof titleSearchVariants === 'function'
      ? titleSearchVariants(q)
      : [q, typeof cleanAnimeTitle === 'function' ? cleanAnimeTitle(q) : q];

    const seen = new Set();
    const combined = [];
    let totalPages = 1;

    for (const query of variants) {
      const [movies, tv, multi] = await Promise.all([
        tmdb('/search/movie', { query, page, include_adult: 'false' }).catch(() => ({ results: [] })),
        tmdb('/search/tv', { query, page, include_adult: 'false' }).catch(() => ({ results: [] })),
        tmdb('/search/multi', { query, page, include_adult: 'false' }).catch(() => ({ results: [] }))
      ]);
      totalPages = Math.max(totalPages, movies.total_pages || 1, tv.total_pages || 1);

      const batch = [
        ...mapTv(tv.results),
        ...(movies.results || []).map(m => ({ ...m, media_type: 'movie' })),
        ...(multi.results || [])
          .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
          .map(r => r.media_type === 'tv'
            ? { ...r, title: r.name, release_date: r.first_air_date, media_type: 'tv' }
            : { ...r, media_type: 'movie' })
      ];
      for (const m of batch) {
        const key = (m.media_type || 'x') + ':' + m.id;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push(m);
      }
      if (combined.length >= 8) break;
    }

    res.render('search', {
      title: `Search: ${q}`,
      q,
      movies: combined,
      page,
      totalPages,
      totalResults: combined.length
    });
  } catch (err) {
    next(err);
  }
});

app.get('/movies', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const data = await tmdb('/movie/popular', { page });
    res.render('genre', {
      title: 'Movies',
      genre: { id: 'movies', name: 'Movies' },
      movies: data.results || [],
      page,
      totalPages: data.total_pages || 1
    });
  } catch (err) {
    next(err);
  }
});

app.get('/tv', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const data = await tmdb('/tv/popular', { page });
    res.render('genre', {
      title: 'TV Shows',
      genre: { id: 'tv', name: 'TV Shows' },
      movies: mapTv(data.results),
      page,
      totalPages: data.total_pages || 1
    });
  } catch (err) {
    next(err);
  }
});

app.get('/genre/:id', async (req, res, next) => {
  const genreId = req.params.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const [genres, data] = await Promise.all([
      tmdb('/genre/movie/list'),
      tmdb('/discover/movie', { with_genres: genreId, page, sort_by: 'popularity.desc' })
    ]);
    const genre = (genres.genres || []).find(g => g.id == genreId);
    if (!genre) return res.status(404).render('error', { title: 'Not Found', message: 'Genre not found' });
    res.render('genre', {
      title: `${genre.name} Movies`,
      genre,
      movies: data.results || [],
      page,
      totalPages: data.total_pages || 1
    });
  } catch (err) {
    next(err);
  }
});

app.get('/genres', async (req, res, next) => {
  try {
    const data = await tmdb('/genre/movie/list');
    res.render('genres', { title: 'Categories', genres: data.genres || [] });
  } catch (err) {
    next(err);
  }
});

app.get('/pinoy', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const q = (req.query.q || '').trim();
  const sort = (req.query.sort || 'popular').toLowerCase();
  try {
    let movies = [];
    let totalPages = 1;
    const sortBy = (sort === 'most' || sort === 'most_watched') ? 'vote_count.desc' : 'popularity.desc';
    if (q) {
      const data = await tmdb('/search/movie', { query: q, page, include_adult: 'false', region: 'PH' });
      movies = data.results || [];
      totalPages = data.total_pages || 1;
      if (sortBy === 'vote_count.desc') movies.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
    } else {
      const data = await tmdb('/discover/movie', {
        with_original_language: 'tl',
        sort_by: sortBy,
        page,
        region: 'PH'
      });
      movies = data.results || [];
      totalPages = data.total_pages || 1;
      if (movies.length < 6) {
        const extra = await tmdb('/search/movie', { query: 'filipino', page: 1, include_adult: 'false' });
        const ids = new Set(movies.map(m => m.id));
        for (const m of (extra.results || [])) {
          if (!ids.has(m.id)) movies.push(m);
        }
      }
    }
    res.render('genre', {
      title: q ? `Pinoy: ${q}` : 'Pinoy / Vivamax',
      genre: { id: 'pinoy', name: 'Pinoy / Vivamax' },
      movies,
      page,
      totalPages,
      q,
      sort: sortBy === 'vote_count.desc' ? 'most' : 'popular'
    });
  } catch (err) {
    next(err);
  }
});

app.get('/play', (req, res) => {
  res.render('play', { title: 'Load Player by ID', id: '' });
});

app.post('/play', (req, res) => {
  const id = (req.body.id || '').trim();
  if (!id) return res.redirect('/play');
  if (id.toLowerCase().startsWith('tt')) return res.redirect(`/watch/imdb/${id}`);
  res.redirect(`/watch/${encodeURIComponent(id)}`);
});

app.get('/watch/imdb/:imdb', async (req, res, next) => {
  try {
    const data = await tmdb(`/find/${req.params.imdb}`, { external_source: 'imdb_id' });
    const movie = (data.movie_results && data.movie_results[0]) || null;
    if (!movie) return res.status(404).render('error', { title: 'Not Found', message: 'No movie found for that IMDb ID' });
    res.redirect(`/watch/${movie.id}`);
  } catch (err) {
    next(err);
  }
});

app.get('/watch/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const [movie, credits, similar, videos, externalIds] = await Promise.all([
      tmdb(`/movie/${id}`),
      tmdb(`/movie/${id}/credits`),
      tmdb(`/movie/${id}/similar`),
      tmdb(`/movie/${id}/videos`),
      tmdb(`/movie/${id}/external_ids`).catch(() => ({}))
    ]);
    const imdbId = externalIds.imdb_id || '';
    const embeds = [
      { name: 'VidStuck', url: `https://embed.vidstuck.xyz/embed/movie/${id}?back=1&branding=streamex` },
      { name: 'ZXC Stream', url: `https://zxcstream.xyz/player/movie/${id}` },
      { name: 'Vidsrc', url: `https://vidsrc.party/embed/movie/${id}` },
      { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1` },
      { name: 'SuperEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1&server=1` },
      { name: 'VidSrc Top', url: `https://vid-src.top/embed/movie/${id}` },
      { name: 'VidSrc Pro', url: `https://vidsrc.pro/embed/movie/${id}` },
      { name: 'Embed.su', url: `https://embed.su/embed/movie/${id}` },
      { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${id}` },
      { name: 'VidSrc', url: `https://vidsrc.me/embed/movie/${id}` },
      { name: '2Embed', url: `https://www.2embed.cc/embed/${id}` },
      { name: 'MoviesAPI', url: `https://moviesapi.club/movie/${id}` }
    ];
    if (imdbId) {
      embeds.push(
        { name: 'VidSrc (IMDb)', url: `https://vidsrc.me/embed/movie?imdb=${imdbId}` },
        { name: '2Embed (IMDb)', url: `https://www.2embed.cc/embed/${imdbId}` }
      );
    }
    const trailer = (videos.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
    res.render('watch', {
      title: movie.title,
      movie,
      embeds,
      cast: (credits.cast || []).slice(0, 12),
      crew: (credits.crew || []).filter(c => ['Director', 'Writer'].includes(c.job)).slice(0, 4),
      similar: (similar.results || []).slice(0, 12),
      trailer: trailer ? `https://www.youtube.com/embed/${trailer.key}` : null,
      mediaType: 'movie'
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).render('error', { title: 'Not Found', message: 'Movie not found' });
    next(err);
  }
});

// TV watch — default to LATEST episode
app.get('/tv/watch/:id', async (req, res, next) => {
  const { id } = req.params;
  try {
    const show = await tmdb(`/tv/${id}`);
    const last = show.last_episode_to_air || null;
    const defaultSeason = last?.season_number || 1;
    const defaultEpisode = last?.episode_number || 1;
    const season = Math.max(1, parseInt(req.query.s) || defaultSeason);
    const episode = Math.max(1, parseInt(req.query.e) || defaultEpisode);

    const [credits, similar, videos, seasonData, externalIds] = await Promise.all([
      tmdb(`/tv/${id}/credits`),
      tmdb(`/tv/${id}/similar`),
      tmdb(`/tv/${id}/videos`),
      tmdb(`/tv/${id}/season/${season}`).catch(() => ({ episodes: [] })),
      tmdb(`/tv/${id}/external_ids`).catch(() => ({}))
    ]);

    const movie = {
      ...show,
      title: show.name,
      release_date: show.first_air_date,
      runtime: null,
      overview: show.overview
    };
    const imdbId = externalIds.imdb_id || '';
    const embeds = [
      { name: 'VidStuck', url: `https://embed.vidstuck.xyz/embed/tv/${id}/${season}/${episode}?back=1&branding=streamex` },
      { name: 'ZXC Stream', url: `https://zxcstream.xyz/player/tv/${id}/${season}/${episode}` },      
      { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${season}&e=${episode}` },
      { name: 'My Server', url: `https://vidsrc.party/embed/tv/${id}/${season}/${episode}` },
      { name: 'SuperEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${season}&e=${episode}&server=1` },
      { name: 'VidSrc Top', url: `https://vid-src.top/embed/tv/${id}/${season}/${episode}` },
      { name: 'VidSrc Pro', url: `https://vidsrc.pro/embed/tv/${id}/${season}/${episode}` },
      { name: 'Embed.su', url: `https://embed.su/embed/tv/${id}/${season}/${episode}` },
      { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${id}/${season}/${episode}` },
      { name: 'VidSrc.cc', url: `https://vidsrc.cc/v2/embed/tv/${id}/${season}/${episode}` },
      { name: 'VidSrc', url: `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}` },
      { name: '2Embed', url: `https://www.2embed.cc/embedtv/${id}?s=${season}&e=${episode}` },
      { name: 'MoviesAPI', url: `https://moviesapi.club/tv/${id}-${season}-${episode}` }
    ];
    if (imdbId) {
      embeds.push(
        { name: 'VidSrc (IMDb)', url: `https://vidsrc.me/embed/tv?imdb=${imdbId}&season=${season}&episode=${episode}` },
        { name: '2Embed (IMDb)', url: `https://www.2embed.cc/embedtv/${imdbId}?s=${season}&e=${episode}` }
      );
    }
    const trailer = (videos.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
    // Episode list: ONLY aired episodes (no future E2–E13 placeholders)
    const today = todayISO();
    let episodes = (seasonData.episodes || [])
      .filter(ep => {
        if (!ep.episode_number) return false;
        // Keep if already aired or air_date missing but number <= last aired on this season
        if (ep.air_date) return ep.air_date <= today;
        return false;
      })
      .map(ep => ({
        episode_number: ep.episode_number,
        name: ep.name || (`Episode ${ep.episode_number}`),
        air_date: ep.air_date || null
      }));

    const byNum = new Map(episodes.map(ep => [ep.episode_number, ep]));

    // Always include TMDB last_episode_to_air for this season
    if (last && last.season_number === season && last.episode_number) {
      if (!last.air_date || last.air_date <= today) {
        byNum.set(last.episode_number, {
          episode_number: last.episode_number,
          name: last.name || (`Episode ${last.episode_number}`),
          air_date: last.air_date || null
        });
      }
    }

    // Ensure continuous 1..maxAired so gaps don't hide early eps
    const maxAired = byNum.size
      ? Math.max(...byNum.keys())
      : (episode || 1);
    for (let n = 1; n <= maxAired; n++) {
      if (!byNum.has(n)) {
        // Only back-fill if this number is <= known aired max (TMDB sometimes omits rows)
        byNum.set(n, {
          episode_number: n,
          name: `Episode ${n}`,
          air_date: null
        });
      }
    }

    episodes = [...byNum.values()].sort((a, b) => a.episode_number - b.episode_number);

    // If still empty, show at least current episode only
    if (!episodes.length) {
      episodes = [{ episode_number: episode || 1, name: `Episode ${episode || 1}`, air_date: null }];
    }

    const seasonList = (show.seasons || [])
      .filter(s => s.season_number > 0)
      .map(s => ({ number: s.season_number, name: s.name, episode_count: s.episode_count }));

    res.render('watch', {
      title: `${movie.title} · S${season}E${episode}`,
      movie,
      embeds,
      cast: (credits.cast || []).slice(0, 12),
      crew: (credits.crew || []).filter(c => ['Creator', 'Director', 'Writer'].includes(c.job)).slice(0, 4),
      similar: mapTv(similar.results).slice(0, 12),
      trailer: trailer ? `https://www.youtube.com/embed/${trailer.key}` : null,
      mediaType: 'tv',
      season,
      episode,
      seasons: show.number_of_seasons || 1,
      seasonList,
      episodes
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).render('error', { title: 'Not Found', message: 'TV show not found' });
    next(err);
  }
});

app.get('/anime', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const type = (req.query.type || 'tv').toLowerCase();
  const today = todayISO();
  try {
    let data, items;
    if (type === 'movie') {
      data = await tmdb('/discover/movie', {
        with_genres: 16,
        sort_by: 'popularity.desc',
        page,
        'primary_release_date.lte': today
      });
      items = (data.results || []).filter(m => {
        const d = m.release_date || '';
        return !d || d <= today;
      });
    } else {
      // Currently airing anime + recent episode air dates only (no 2027–2030 filler)
      const win14 = daysAgoISO(14);
      const [aired, onAir] = await Promise.all([
        tmdb('/discover/tv', {
          with_genres: 16,
          'air_date.gte': win14,
          'air_date.lte': today,
          'first_air_date.lte': today,
          sort_by: 'popularity.desc',
          page
        }),
        tmdb('/discover/tv', {
          with_genres: 16,
          'first_air_date.lte': today,
          sort_by: 'popularity.desc',
          page,
          with_status: '0' // Returning Series
        }).catch(() => ({ results: [], total_pages: 1 }))
      ]);
      const byId = new Map();
      for (const s of [...(aired.results || []), ...(onAir.results || [])]) {
        const fad = s.first_air_date || '';
        if (fad && fad > today) continue;
        if (!byId.has(s.id)) byId.set(s.id, s);
      }
      items = mapTv([...byId.values()]);
      data = { total_pages: Math.max(aired.total_pages || 1, onAir.total_pages || 1) };
      // If thin page, fall back to on_the_air filtered to animation genre via details is heavy;
      // secondary: popular anime that already started
      if (items.length < 8) {
        const pop = await tmdb('/discover/tv', {
          with_genres: 16,
          'first_air_date.lte': today,
          sort_by: 'popularity.desc',
          page
        });
        for (const s of (pop.results || [])) {
          const fad = s.first_air_date || '';
          if (fad && fad > today) continue;
          if (!byId.has(s.id)) {
            byId.set(s.id, s);
            items.push(...mapTv([s]));
          }
        }
        data = pop;
        items = mapTv([...byId.values()]);
      }
    }
    res.render('genre', {
      title: type === 'movie' ? 'Anime Movies' : 'Anime Series',
      genre: { id: 'anime', name: type === 'movie' ? 'Anime Movies' : 'Anime Series' },
      movies: items,
      page,
      totalPages: data.total_pages || 1,
      animeType: type
    });
  } catch (err) {
    next(err);
  }
});

app.get('/asian', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const country = (req.query.country || 'KR').toUpperCase();
  const allowed = { KR: 'Korea', CN: 'China', TW: 'Taiwan', TH: 'Thailand', JP: 'Japan', ALL: 'All Asian' };
  const label = allowed[country] || 'Korea';
  const today = todayISO();
  const win14 = daysAgoISO(14);
  try {
    let data;
    if (country === 'ALL') {
      const codes = ['KR', 'CN', 'TW', 'TH', 'JP'];
      const results = await Promise.all(
        codes.map(c => tmdb('/discover/tv', {
          with_origin_country: c,
          'air_date.gte': win14,
          'air_date.lte': today,
          'first_air_date.lte': today,
          sort_by: 'popularity.desc',
          page: 1
        }).catch(() => ({ results: [] })))
      );
      const seen = new Set();
      const merged = [];
      for (const r of results) {
        for (const s of (r.results || [])) {
          const fad = s.first_air_date || '';
          if (fad && fad > today) continue;
          if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
        }
      }
      data = { results: merged.slice(0, 24), total_pages: 1 };
    } else {
      data = await tmdb('/discover/tv', {
        with_origin_country: country,
        'air_date.gte': win14,
        'air_date.lte': today,
        'first_air_date.lte': today,
        sort_by: 'popularity.desc',
        page
      });
      // fallback: returning series already started
      if (!(data.results || []).length) {
        data = await tmdb('/discover/tv', {
          with_origin_country: country,
          'first_air_date.lte': today,
          sort_by: 'popularity.desc',
          page
        });
      }
      data.results = (data.results || []).filter(s => {
        const fad = s.first_air_date || '';
        return !fad || fad <= today;
      });
    }
    res.render('genre', {
      title: country === 'KR' ? 'K-Drama' : `${label} Drama`,
      genre: { id: 'asian', name: country === 'KR' ? 'K-Drama / Asian' : `${label} Drama` },
      movies: mapTv(data.results),
      page,
      totalPages: data.total_pages || 1,
      asianCountry: country
    });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found' });
});

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: err.message || 'An unexpected error occurred.' });
});

app.listen(PORT, () => {
  console.log(`${SITE_NAME} running at http://localhost:${PORT}`);
});
