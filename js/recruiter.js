// Builds the post list under each section link in the sidebar, and marks the
// post currently on screen. The posts in the page are the only source of
// truth: add an <article class="post"> and its link appears.

const nav = document.querySelector(".toc");

const slug = (text) =>
  text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");

for (const sectionLink of nav.querySelectorAll(".toc__section")) {
  const heading = document.querySelector(sectionLink.hash);
  const posts = heading?.closest(".collection")?.querySelectorAll(".post") ?? [];
  if (!posts.length) continue;

  const list = document.createElement("ol");
  list.className = "toc__posts";
  for (const post of posts) {
    const title = post.querySelector(".post__title")?.textContent.trim() ?? "Untitled";
    if (!post.id) {
      // Two posts with the same title would share a link; number the repeats.
      let id = slug(title), n = 1;
      while (document.getElementById(id)) id = `${slug(title)}-${++n}`;
      post.id = id;
    }

    const a = document.createElement("a");
    a.href = `#${post.id}`;
    a.textContent = title;
    const item = document.createElement("li");
    item.append(a);
    list.append(item);
  }
  // Wrapped so CSS can fold it open on hover (see .toc__fold).
  const fold = document.createElement("div");
  fold.className = "toc__fold";
  fold.append(list);
  sectionLink.after(fold);
}

// Scroll marker. A post counts as "on screen" while it crosses a band from
// 20% to 35% of the way down the viewport, roughly where the eye reads.
const links = new Map(
  [...nav.querySelectorAll(".toc__posts a")].map((a) => [a.hash.slice(1), a])
);

if (links.size) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const a of links.values()) a.removeAttribute("aria-current");
        links.get(entry.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-20% 0px -65% 0px" }
  );
  for (const id of links.keys()) observer.observe(document.getElementById(id));
}
