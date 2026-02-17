(function() {
  var tree = window.__NAV_TREE__;
  var currentSlug = window.__CURRENT_SLUG__;
  var pathToRoot = window.__PATH_TO_ROOT__;
  var container = document.getElementById('nav-tree');
  if (!tree || !container) return;

  function buildNav(node, depth) {
    var el = document.createElement('div');

    if (node.slug !== null) {
      // File node
      el.className = 'nav-file';
      var a = document.createElement('a');
      a.href = pathToRoot + node.slug + '.html';
      a.textContent = node.name;
      if (node.slug === currentSlug) a.className = 'is-active';
      el.appendChild(a);
    } else if (depth > 0) {
      // Folder node (skip root)
      el.className = 'nav-folder';
      var title = document.createElement('div');
      title.className = 'nav-folder-title';
      title.innerHTML = '<span class="collapse-icon">&#9660;</span>' + escapeHtml(node.name);

      var children = document.createElement('div');
      children.className = 'nav-folder-children';

      // Check localStorage for collapsed state
      var storageKey = 'nav-collapsed-' + node.name;
      var isCollapsed = localStorage.getItem(storageKey) === '1';
      if (isCollapsed) {
        title.classList.add('is-collapsed');
        children.classList.add('is-collapsed');
      }

      title.addEventListener('click', function() {
        var collapsed = children.classList.toggle('is-collapsed');
        title.classList.toggle('is-collapsed');
        localStorage.setItem(storageKey, collapsed ? '1' : '0');
      });

      for (var i = 0; i < node.children.length; i++) {
        children.appendChild(buildNav(node.children[i], depth + 1));
      }

      el.appendChild(title);
      el.appendChild(children);
    } else {
      // Root level: just render children
      for (var i = 0; i < node.children.length; i++) {
        el.appendChild(buildNav(node.children[i], depth + 1));
      }
    }

    return el;
  }

  function escapeHtml(t) {
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  container.appendChild(buildNav(tree, 0));

  // Mobile sidebar toggle
  var toggle = document.querySelector('.sidebar-toggle');
  var sidebar = document.getElementById('site-sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', function() {
      sidebar.classList.toggle('is-open');
    });
    // Close sidebar when clicking content on mobile
    document.querySelector('.site-content').addEventListener('click', function() {
      sidebar.classList.remove('is-open');
    });
  }
})();
