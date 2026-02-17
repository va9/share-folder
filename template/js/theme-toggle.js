(function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;

  var saved = localStorage.getItem('site-theme');
  if (saved) {
    document.body.setAttribute('data-theme', saved);
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.body.setAttribute('data-theme', 'dark');
  }

  btn.addEventListener('click', function() {
    var current = document.body.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('site-theme', next);
  });
})();
