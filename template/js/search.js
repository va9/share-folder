(function() {
  var searchIndexUrl = window.__SEARCH_INDEX_URL__;
  var pathToRoot = window.__PATH_TO_ROOT__;
  var overlay = document.getElementById('search-overlay');
  var input = document.getElementById('search-input');
  var results = document.getElementById('search-results');
  var trigger = document.getElementById('search-trigger');
  var searchData = null;

  function loadIndex() {
    if (searchData) return Promise.resolve();
    return fetch(searchIndexUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) { searchData = data; });
  }

  function openSearch() {
    overlay.style.display = 'flex';
    input.value = '';
    results.innerHTML = '';
    input.focus();
    loadIndex();
  }

  function closeSearch() {
    overlay.style.display = 'none';
  }

  function doSearch(query) {
    if (!searchData || !query) { results.innerHTML = ''; return; }
    var q = query.toLowerCase();
    var matches = searchData.filter(function(item) {
      return item.t.toLowerCase().indexOf(q) !== -1 ||
             item.c.toLowerCase().indexOf(q) !== -1 ||
             (item.g && item.g.some(function(tag) { return tag.indexOf(q) !== -1; }));
    }).slice(0, 10);

    results.innerHTML = '';
    matches.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'search-result-item';
      var titleDiv = document.createElement('div');
      titleDiv.className = 'result-title';
      titleDiv.textContent = item.t;
      var previewDiv = document.createElement('div');
      previewDiv.className = 'result-preview';
      var idx = item.c.toLowerCase().indexOf(q);
      if (idx !== -1) {
        var start = Math.max(0, idx - 40);
        var end = Math.min(item.c.length, idx + q.length + 60);
        previewDiv.textContent = (start > 0 ? '...' : '') + item.c.slice(start, end) + (end < item.c.length ? '...' : '');
      } else {
        previewDiv.textContent = item.c.slice(0, 100) + (item.c.length > 100 ? '...' : '');
      }
      div.appendChild(titleDiv);
      div.appendChild(previewDiv);
      div.addEventListener('click', function() {
        window.location.href = pathToRoot + item.s + '.html';
      });
      results.appendChild(div);
    });
  }

  if (trigger) trigger.addEventListener('click', openSearch);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSearch();
  });

  input.addEventListener('input', function() { doSearch(input.value); });

  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (overlay.style.display === 'flex') closeSearch();
      else openSearch();
    }
    if (e.key === 'Escape') closeSearch();
  });
})();
