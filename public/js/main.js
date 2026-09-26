// Mobile menu (side drawer)
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');
const navBackdrop = document.getElementById('navBackdrop');

function closeMobileNav() {
  if (mobileNav) mobileNav.classList.remove('open');
  if (menuToggle) menuToggle.classList.remove('active');
  if (navBackdrop) navBackdrop.classList.remove('show');
  document.body.style.overflow = '';
}

function openMobileNav() {
  if (mobileNav) mobileNav.classList.add('open');
  if (menuToggle) menuToggle.classList.add('active');
  if (navBackdrop) navBackdrop.classList.add('show');
  document.body.style.overflow = 'hidden';
}

if (menuToggle && mobileNav) {
  menuToggle.addEventListener('click', () => {
    if (mobileNav.classList.contains('open')) closeMobileNav();
    else openMobileNav();
  });
  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMobileNav);
  });
}
if (navBackdrop) {
  navBackdrop.addEventListener('click', closeMobileNav);
}
const mobileNavClose = document.getElementById('mobileNavClose');
if (mobileNavClose) {
  mobileNavClose.addEventListener('click', closeMobileNav);
}

// Server switcher (watch page)
const servers = document.getElementById('servers');
const player = document.getElementById('player');
if (servers && player) {
  servers.addEventListener('click', (e) => {
    const btn = e.target.closest('.server-btn');
    if (!btn || !btn.dataset.url) return;
    player.src = btn.dataset.url;
    servers.querySelectorAll('.server-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
}

// Hero slider
(function () {
  const slider = document.getElementById('heroSlider');
  if (!slider) return;

  const slides = slider.querySelectorAll('.hero-slide');
  const dots = slider.querySelectorAll('.hero-dot');
  const prevBtn = document.getElementById('heroPrev');
  const nextBtn = document.getElementById('heroNext');
  if (slides.length < 2) return;

  let current = 0;
  let timer = null;
  const INTERVAL = 5500;

  function goTo(index) {
    slides[current].classList.remove('active');
    if (dots[current]) dots[current].classList.remove('active');
    current = (index + slides.length) % slides.length;
    slides[current].classList.add('active');
    if (dots[current]) dots[current].classList.add('active');
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  function startAuto() {
    stopAuto();
    timer = setInterval(next, INTERVAL);
  }
  function stopAuto() {
    if (timer) clearInterval(timer);
  }

  if (nextBtn) nextBtn.addEventListener('click', () => { next(); startAuto(); });
  if (prevBtn) prevBtn.addEventListener('click', () => { prev(); startAuto(); });

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      goTo(parseInt(dot.dataset.index, 10));
      startAuto();
    });
  });

  slider.addEventListener('mouseenter', stopAuto);
  slider.addEventListener('mouseleave', startAuto);

  // Touch swipe
  let touchStartX = 0;
  slider.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    stopAuto();
  }, { passive: true });
  slider.addEventListener('touchend', e => {
    const diff = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(diff) > 50) {
      diff < 0 ? next() : prev();
    }
    startAuto();
  }, { passive: true });

  startAuto();
})();


// --- Fuzzy helpers ---
function fuzzyMatch(text, query) {
  if (!query) return true;
  text = (text || '').toLowerCase();
  query = query.toLowerCase().trim();
  if (text.includes(query)) return true;
  // simple subsequence fuzzy: all query chars in order
  let ti = 0;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (ch === ' ') continue;
    const found = text.indexOf(ch, ti);
    if (found === -1) return false;
    ti = found + 1;
  }
  return true;
}

// Categories page: tabs + fuzzy filter
(function () {
  const grid = document.getElementById('genreGrid');
  const input = document.getElementById('catSearchInput');
  const tabs = document.getElementById('catTabs');
  const empty = document.getElementById('catEmpty');
  if (!grid) return;

  const asian = document.getElementById('asianGrid');
  const cards = Array.from(grid.querySelectorAll('.genre-card')).concat(asian ? Array.from(asian.querySelectorAll('.genre-card')) : []);
  let activeTab = 'all';

  const tabMap = {
    all: null,
    action: ['action'],
    comedy: ['comedy'],
    drama: ['drama'],
    horror: ['horror'],
    romance: ['romance'],
    animation: ['animation', 'anime'],
    thriller: ['thriller', 'crime', 'mystery'],
    scifi: ['science fiction', 'sci-fi', 'scifi', 'fantasy']
  };

  function apply() {
    const q = input ? input.value : '';
    let visible = 0;
    cards.forEach(card => {
      const name = card.dataset.name || '';
      const tabKeys = tabMap[activeTab];
      const tabOk = !tabKeys || tabKeys.some(k => name.includes(k));
      const fuzzyOk = fuzzyMatch(name, q);
      const show = tabOk && fuzzyOk;
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    if (empty) empty.hidden = visible > 0;
  }

  if (tabs) {
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.cat-tab');
      if (!btn) return;
      tabs.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.filter || 'all';
      apply();
    });
  }
  if (input) {
    input.addEventListener('input', apply);
  }
})();

// Pinoy / any page: live fuzzy on .fuzzy-item cards
(function () {
  const pinoyInput = document.querySelector('.pinoy-search input[name="q"]');
  const items = document.querySelectorAll('.fuzzy-item');
  if (!items.length) return;

  // Optional: live filter without submit when typing (debounce) — still allow form submit for server search
  if (pinoyInput && items.length) {
    let t;
    pinoyInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const q = pinoyInput.value;
        // only client-filter if user hasn't submitted long query yet - always filter visible
        let vis = 0;
        items.forEach(el => {
          const title = el.dataset.title || '';
          const orig = el.dataset.original || '';
          const ok = fuzzyMatch(title, q) || fuzzyMatch(orig, q);
          el.style.display = ok ? '' : 'none';
          if (ok) vis++;
        });
      }, 120);
    });
  }
})();
