document.querySelectorAll("include-bottom-nav").forEach(el => {
  el.outerHTML = `
  <nav class="bottom-nav">
    <a class="nav-item" data-page="home" href="home.html">🏠 Home</a>
    <a class="nav-item" data-page="explore" href="feed.html">🔍 Explore</a>
    <a class="create" href="admin.html">+</a>
    <a class="nav-item" data-page="profile" href="admin.html">👤 Profile</a>
  </nav>
  `;

  const current = location.pathname.split("/").pop();
  const mapping = {
    "home.html": "home",
    "feed.html": "explore",
    "admin.html": "profile"
  };

  document.querySelectorAll(".nav-item").forEach(item => {
    if (item.dataset.page === mapping[current]) {
      item.classList.add("active");
    }
  });
});
