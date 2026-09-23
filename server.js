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

// Make helpers available in every template
app.use((req, res, next) => {
  res.locals.siteName = SITE_NAME;
  res.locals.img = (path, size = 'w500') => path ? `${IMG}/${size}${path}` : '/img/no-poster.jpg';
  res.locals.year = (date) => date ? date.slice(0, 4) : '';
  next();
});

async function tmdb(endpoint, params = {}) {
  const url = new URL(`${TMDB}${endpoint}`);
  url.searchParams.set('api_key', TMDB_KEY);
  url.searchParams.set('language', 'en-US');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

// Home
app.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const [popular, topRated, upcoming, nowPlaying] = await Promise.all([
      tmdb('/movie/popular', { page }),
      tmdb('/movie/top_rated', { page: 1 }),
      tmdb('/movie/upcoming', { page: 1 }),
      tmdb('/movie/now_playing', { page: 1 })
    ]);

    const featured = (popular.results || []).filter(m => m.backdrop_path).slice(0, 6);

    res.render('index', {
      title: 'Watch Free Movies Online',
      featured,
      popular: popular.results || [],
      topRated: topRated.results || [],
      upcoming: upcoming.results || [],
      nowPlaying: nowPlaying.results || [],
      page,
      totalPages: popular.total_pages || 1
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load movies' });
  }
});

// Search
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;

  if (!q) return res.redirect('/');

  try {
    const data = await tmdb('/search/movie', { query: q, page, include_adult: 'false' });
    res.render('search', {
      title: `Search: ${q}`,
      q,
      movies: data.results || [],
      page,
      totalPages: data.total_pages || 1,
      totalResults: data.total_results || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Search failed' });
  }
});

// Genre
app.get('/genre/:id', async (req, res) => {
  const genreId = req.params.id;
  const page = parseInt(req.query.page) || 1;

  try {
    const [genres, data] = await Promise.all([
      tmdb('/genre/movie/list'),
      tmdb('/discover/movie', {
        with_genres: genreId,
        page,
        sort_by: 'popularity.desc'
      })
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
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load genre' });
  }
});

// Watch page
app.get('/watch/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [movie, credits, similar, videos] = await Promise.all([
      tmdb(`/movie/${id}`),
      tmdb(`/movie/${id}/credits`),
      tmdb(`/movie/${id}/similar`),
      tmdb(`/movie/${id}/videos`)
    ]);

    if (movie.status_code === 34) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Movie not found' });
    }

    // Free embed sources (TMDB ID based)
    const embeds = [
      { name: 'ZXC Stream', url: `https://zxcstream.xyz/embed/movie/${id}` },
      { name: 'VidSrc Top', url: `https://vid-src.top/embed/movie/${id}` },
      { name: 'MultiEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1` },
      { name: '2Embed', url: `https://www.2embed.cc/embed/${id}` },
      { name: 'VidRift', url: `https://embed.vidrift.in/embed/movie/${id}` },
      { name: 'SuperEmbed', url: `https://multiembed.mov/?video_id=${id}&tmdb=1&server=1` }
    ];

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
      trailer: trailer ? `https://www.youtube.com/embed/${trailer.key}` : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load movie' });
  }
});

// Genres list (for nav)
app.get('/genres', async (req, res) => {
  try {
    const data = await tmdb('/genre/movie/list');
    res.render('genres', {
      title: 'All Genres',
      genres: data.genres || []
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load genres' });
  }
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found' });
});

app.listen(PORT, () => {
  console.log(`${SITE_NAME} running at http://localhost:${PORT}`);
});
