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
  console.error('Missing TMDB_KEY in .env file.');
  process.exit(1);
}

// App Settings & Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set global view locals
app.use((req, res, next) => {
  res.locals.siteName = SITE_NAME;
  res.locals.img = (p, size = 'w500') => (p ? `${IMG}/${size}${p}` : '/img/no-poster.jpg');
  res.locals.year = (date) => (date ? String(date).slice(0, 4) : '');
  res.locals.path = req.path;
  next();
});

// TMDB API Fetch Wrapper
async function tmdb(endpoint, params = {}) {
  const url = new URL(`${TMDB}${endpoint}`);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'en-US');

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(url.toString());
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const err = new Error(errorData.status_message || `TMDB Request Failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// --- ROUTES ---

// Home Page
app.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    
    const [popular, topRated, upcoming, nowPlaying, anime, animeTv, tvPopular, kdrama] = await Promise.all([
      tmdb('/movie/popular', { page }),
      tmdb('/movie/top_rated', { page: 1 }),
      tmdb('/movie/upcoming', { page: 1 }),
      tmdb('/movie/now_playing', { page: 1 }),
      tmdb('/discover/movie', { with_genres: 16, sort_by: 'popularity.desc', page: 1 }),
      tmdb('/discover/tv', { with_genres: 16, sort_by: 'popularity.desc', page: 1 }),
      tmdb('/tv/popular', { page: 1 }),
      tmdb('/discover/tv', { with_origin_country: 'KR', sort_by: 'popularity.desc', page: 1 })
    ]);

    const featured = (popular.results || []).filter(m => m.backdrop_path).slice(0, 6);

    const mapTv = (list) => (list || []).map(s => ({
      ...s,
      title: s.name || s.title,
      release_date: s.first_air_date || s.release_date,
      media_type: 'tv'
    }));

    res.render('index', {
      title: 'Watch Free Movies Online',
      featured,
      popular: popular.results || [],
      topRated: topRated.results || [],
      upcoming: upcoming.results || [],
      nowPlaying: nowPlaying.results || [],
      anime: anime.results || [],
      animeTv: mapTv(animeTv.results),
      tvPopular: mapTv(tvPopular.results),
      kdrama: mapTv(kdrama.results),
      page,
      totalPages: popular.total_pages || 1
    });
  } catch (err) {
    next(err);
  }
});

// Search
app.get('/search', async (req, res, next) => {
  const q = (req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  if (!q) return res.redirect('/');

  try {
    const [movies, tv] = await Promise.all([
      tmdb('/search/movie', { query: q, page, include_adult: 'false' }),
      tmdb('/search/tv', { query: q, page, include_adult: 'false' })
    ]);

    const movieResults = (movies.results || []).map(m => ({ ...m, media_type: 'movie' }));
    const tvResults = (tv.results || []).map(t => ({
      ...t,
      title: t.name,
      release_date: t.first_air_date,
      media_type: 'tv'
    }));

    const combined = [...movieResults, ...tvResults];

    res.render('search', {
      title: `Search: ${q}`,
      q,
      movies: combined,
      page,
      totalPages: Math.max(movies.total_pages || 1, tv.total_pages || 1),
      totalResults: (movies.total_results || 0) + (tv.total_results || 0)
    });
  } catch (err) {
    next(err);
  }
});

// Movies List
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

// TV Shows List
app.get('/tv', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const data = await tmdb('/tv/popular', { page });
    const shows = (data.results || []).map(t => ({
      ...t,
      title: t.name,
      release_date: t.first_air_date
    }));

    res.render('genre', {
      title: 'TV Shows',
      genre: { id: 'tv', name: 'TV Shows' },
      movies: shows,
      page,
      totalPages: data.total_pages || 1
    });
  } catch (err) {
    next(err);
  }
});

// Genre (Movies)
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

// Categories Page
app.get('/genres', async (req, res, next) => {
  try {
    const data = await tmdb('/genre/movie/list');
    res.render('genres', {
      title: 'Categories',
      genres: data.genres || []
    });
  } catch (err) {
    next(err);
  }
});

// Pinoy / Vivamax Movies
app.get('/pinoy', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const q = (req.query.q || '').trim();
  const sort = (req.query.sort || 'popular').toLowerCase();

  try {
    let movies = [];
    let totalPages = 1;
    const sortBy = (sort === 'most' || sort === 'most_watched') ? 'vote_count.desc' : 'popularity.desc';

    if (q) {
      const data = await tmdb('/search/movie', {
        query: q,
        page,
        include_adult: 'false',
        region: 'PH'
      });
      movies = data.results || [];
      totalPages = data.total_pages || 1;
      if (sortBy === 'vote_count.desc') {
        movies.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
      }
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

// Direct Watch Form Page & ID Redirection
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

// Watch Movie
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
      { name: 'ZXC Stream', url: `https://zxcstream.xyz/player/movie/${id}` },
      { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1` },
      { name: 'SuperEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1&server=1` },
      { name: 'VidSrc Top', url: `https://vid-src.top/embed/movie/${id}` },
      { name: 'VidSrc Pro', url: `https://vidsrc.pro/embed/movie/${id}` },
      { name: 'Embed.su', url: `https://embed.su/embed/movie/${id}` },
      { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${id}` },
      { name: 'VidSrc', url: `https://vidsrc.me/embed/movie/${id}` },
      { name: '2Embed', url: `https://www.2embed.cc/embed/${id}` },
      { name: 'VidRift', url: `https://embed.vidrift.in/embed/movie/${id}` },
      { name: 'MoviesAPI', url: `https://moviesapi.club/movie/${id}` }
    ];

    if (imdbId) {
      embeds.push(
        { name: 'VidSrc (IMDb)', url: `https://vidsrc.me/embed/movie?imdb=${imdbId}` },
        { name: '2Embed (IMDb)', url: `https://www.2embed.cc/embed/${imdbId}` }
      );
    }

    const trailer = (videos.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
    const cast = (credits.cast || []).slice(0, 12);
    const crew = (credits.crew || []).filter(c => ['Director', 'Writer'].includes(c.job)).slice(0, 4);

    res.render('watch', {
      title: movie.title,
      movie,
      embeds,
      cast,
      crew,
      similar: (similar.results || []).slice(0, 12),
      trailer: trailer ? `https://www.youtube.com/embed/${trailer.key}` : null,
      mediaType: 'movie'
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Movie not found' });
    }
    next(err);
  }
});

// Watch TV Show
app.get('/tv/watch/:id', async (req, res, next) => {
  const { id } = req.params;
  const season = Math.max(1, parseInt(req.query.s) || 1);
  const episode = Math.max(1, parseInt(req.query.e) || 1);

  try {
    const [show, credits, similar, videos, seasonData, externalIds] = await Promise.all([
      tmdb(`/tv/${id}`),
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
      { name: 'ZXC Stream', url: `https://zxcstream.xyz/player/tv/${id}/${season}/${episode}` },
      { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${season}&e=${episode}` },
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
    const cast = (credits.cast || []).slice(0, 12);
    const crew = (credits.crew || []).filter(c => ['Creator', 'Director', 'Writer'].includes(c.job)).slice(0, 4);

    const similarMapped = (similar.results || []).slice(0, 12).map(t => ({
      ...t,
      title: t.name,
      release_date: t.first_air_date,
      media_type: 'tv'
    }));

    let episodes = (seasonData.episodes || []).map(ep => ({
      episode_number: ep.episode_number,
      name: ep.name,
      still_path: ep.still_path,
      runtime: ep.runtime
    }));

    if (!episodes.length) {
      const count = (show.seasons || []).find(s => s.season_number === season)?.episode_count || 24;
      episodes = Array.from({ length: count }, (_, i) => ({
        episode_number: i + 1,
        name: `Episode ${i + 1}`
      }));
    }

    const seasonList = (show.seasons || [])
      .filter(s => s.season_number > 0)
      .map(s => ({ number: s.season_number, name: s.name, episode_count: s.episode_count }));

    res.render('watch', {
      title: `${movie.title} · S${season}E${episode}`,
      movie,
      embeds,
      cast,
      crew,
      similar: similarMapped,
      trailer: trailer ? `https://www.youtube.com/embed/${trailer.key}` : null,
      mediaType: 'tv',
      season,
      episode,
      seasons: show.number_of_seasons || 1,
      seasonList,
      episodes
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).render('error', { title: 'Not Found', message: 'TV show not found' });
    }
    next(err);
  }
});

// Anime
app.get('/anime', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const type = (req.query.type || 'tv').toLowerCase();

  try {
    let data;
    let items = [];

    if (type === 'movie') {
      data = await tmdb('/discover/movie', {
        with_genres: 16,
        sort_by: 'popularity.desc',
        page,
        'vote_count.gte': 20
      });
      items = data.results || [];
    } else {
      data = await tmdb('/discover/tv', {
        with_genres: 16,
        sort_by: 'popularity.desc',
        page
      });
      items = (data.results || []).map(s => ({
        ...s,
        title: s.name,
        release_date: s.first_air_date,
        media_type: 'tv'
      }));
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

// Asian / K-Drama
app.get('/asian', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const country = (req.query.country || 'KR').toUpperCase();
  const allowed = { KR: 'Korea', CN: 'China', TW: 'Taiwan', TH: 'Thailand', JP: 'Japan', ALL: 'All Asian' };
  const label = allowed[country] || 'Korea';

  try {
    let data;
    if (country === 'ALL') {
      const codes = ['KR', 'CN', 'TW', 'TH', 'JP'];
      const results = await Promise.all(
        codes.map(c => tmdb('/discover/tv', { with_origin_country: c, sort_by: 'popularity.desc', page: 1 }))
      );

      const seen = new Set();
      const merged = [];
      for (const r of results) {
        for (const s of (r.results || [])) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
          }
        }
      }
      merged.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      data = { results: merged.slice(0, 20), total_pages: 1 };
    } else {
      data = await tmdb('/discover/tv', {
        with_origin_country: country,
        sort_by: 'popularity.desc',
        page
      });
    }

    const items = (data.results || []).map(s => ({
      ...s,
      title: s.name,
      release_date: s.first_air_date,
      media_type: 'tv'
    }));

    res.render('genre', {
      title: country === 'KR' ? 'K-Drama' : `${label} Drama`,
      genre: { id: 'asian', name: country === 'KR' ? 'K-Drama / Asian' : `${label} Drama` },
      movies: items,
      page,
      totalPages: data.total_pages || 1,
      asianCountry: country
    });
  } catch (err) {
    next(err);
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found' });
});

// Central Error Handling Middleware
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Error',
    message: err.message || 'An unexpected error occurred.'
  });
});

app.listen(PORT, () => {
  console.log(`${SITE_NAME} running at http://localhost:${PORT}`);
});