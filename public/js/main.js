// Mobile menu
const menuToggle = document.getElementById('menuToggle');
const mobileNav = document.getElementById('mobileNav');

if (menuToggle && mobileNav) {
  menuToggle.addEventListener('click', () => {
    mobileNav.classList.toggle('open');
    menuToggle.classList.toggle('active');
  });
  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => mobileNav.classList.remove('open'));
  });
}

// Server switcher
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

// HTML5 Fullscreen on player
const fsBtn = document.getElementById('fsBtn');
const playerBox = document.querySelector('.player-container');
if (fsBtn && playerBox) {
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      (playerBox.requestFullscreen || playerBox.webkitRequestFullscreen || playerBox.msRequestFullscreen)
        .call(playerBox)
        .catch(() => {});
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen)
        .call(document);
    }
  });
}

// Hero slider (if present)
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
