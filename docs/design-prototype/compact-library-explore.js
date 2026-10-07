/* global document, window, Element */
(() => {
  const required = selector => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing compact-study element: ${selector}`);
    return element;
  };
  const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const sourceBooks = [
    { id: "coast", title: "The Quiet Coast", author: "Mara Vale", color: "#40564e", label: "Field notes", progress: 29, opened: 10 },
    { id: "ulysses", title: "Ulysses", author: "James Joyce", image: "assets/ulysses.svg", progress: 12, opened: 8 },
    { id: "orchard", title: "The Glass Orchard", author: "Nora Fen", color: "#55516b", label: "A novel", progress: null, opened: 0 },
    { id: "glass", title: "Through the Looking-Glass", author: "Lewis Carroll", image: "assets/looking-glass.svg", progress: 64, opened: 5 },
    { id: "tramp", title: "The Autobiography of a Super-Tramp", author: "W. H. Davies", image: "assets/super-tramp.svg", progress: null, opened: 0 },
    { id: "light", title: "A Season of Light", author: "Iris Wren", color: "#69494b", label: "Poems", progress: 8, opened: 4 },
    { id: "atlas", title: "The City Atlas", author: "Eli North", color: "#475b6a", label: "An original sample", progress: 100, opened: 2 },
    { id: "sketchbook", title: "Keeping a Sketchbook", author: "Tess Rill", color: "#675238", label: "An original sample", progress: null, opened: 0 },
  ];
  const groups = [
    { id: "reading", label: "Reading", accepts: book => book.progress !== null && book.progress < 100 },
    { id: "next", label: "Next up", accepts: book => book.progress === null },
    { id: "finished", label: "Finished", accepts: book => book.progress === 100 },
    { id: "all", label: "All", accepts: () => true },
  ];
  const options = [
    { id: "a", title: "A. Return to reading", heading: "Your library", group: "reading", description: "One obvious place to resume. Smaller reading lists follow; the utility controls step back.", className: "resume-first" },
    { id: "b", title: "B. List-first notebook", heading: "Reading lists", group: "reading", description: "Reading lists are the navigation. A calm, cover-and-title list uses the rest of the window.", className: "list-first" },
    { id: "c", title: "C. Small bookshelf", heading: "Your bookshelf", group: "all", description: "Recognize covers first. One list chooser replaces a row of filters; the current book stays marked.", className: "shelf-first" },
  ];
  const state = new Map(options.map(option => [option.id, { group: option.group, query: "", order: "recent" }]));
  let books = [];
  let resumeId = "coast";
  let opened = 10;
  let imported = 0;
  let dialogOrigin;
  const dialog = required("#study-dialog");
  const announce = message => { required("#announcement").textContent = message; };
  window.addEventListener("error", event => announce(`Prototype error: ${event.message}`));

  const cover = book => book.image
    ? `<span class="cover artwork" aria-hidden="true"><img src="${escapeHtml(book.image)}" alt=""></span>`
    : `<span class="cover" style="--cover:${book.color}" aria-hidden="true"><small>${escapeHtml(book.label)}</small><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}</small></span>`;
  const progressText = book => book.progress === null ? "Not started"
    : book.progress === 100 ? "Finished" : `${book.progress}% read`;
  const progress = book => book.progress === null ? ""
    : `<span class="progress-line" aria-hidden="true"><span style="--progress:${book.progress}%"></span></span>`;
  const app = id => required(`.app[data-option="${id}"]`);
  function getState(id) {
    const value = state.get(id);
    if (!value) throw new Error(`Unknown compact option: ${id}`);
    return value;
  }
  function getGroup(id) {
    const group = groups.find(candidate => candidate.id === id);
    if (!group) throw new Error(`Unknown reading list: ${id}`);
    return group;
  }

  required("#comparison-grid").innerHTML = options.map(option => {
    const listControls = option.id === "c"
      ? `<label class="group-picker" for="list-${option.id}">Reading list<select id="list-${option.id}" data-list="${option.id}">${groups.map(group => `<option value="${group.id}">${group.label}</option>`).join("")}</select></label>`
      : `<nav class="lists" aria-label="Reading lists">${groups.filter(group => option.id === "b" || group.id !== "finished").map(group => `<button type="button" data-group="${group.id}" aria-controls="books-${option.id}" aria-pressed="false"></button>`).join("")}</nav>`;
    return `<article class="option">
      <header><h2>${option.title}${option.id === "a" ? '<span class="recommendation">Recommended</span>' : ""}</h2><p>${option.description}</p></header>
      <section class="app ${option.className}" data-option="${option.id}" aria-labelledby="heading-${option.id}">
        <header class="brand-bar"><span class="brand"><img src="assets/ambra-icon.png" alt="">ambra</span>
          <details class="app-menu"><summary aria-label="Ambra options" title="Ambra options">...</summary><div class="app-menu-panel">
            <button type="button" data-action="settings">Settings</button>
            <button type="button" data-action="help">Help &amp; about</button>
            <a href="index.html?view=library&amp;discovery=open" target="_blank" rel="noopener noreferrer">Find books in full preview</a>
          </div></details>
        </header>
        <div class="library-heading"><div class="heading-row"><h3 id="heading-${option.id}">${option.heading}</h3>
          <details class="tools" id="tools-${option.id}"><summary>Find &amp; sort</summary>
          <div class="tool-panel">
            <label for="query-${option.id}">Search title or author<input id="query-${option.id}" type="search" placeholder="Title or author" data-query="${option.id}" aria-controls="books-${option.id}"></label>
            <div><label for="order-${option.id}">Sort books<select id="order-${option.id}" data-order="${option.id}">
              <option value="recent">Last opened</option><option value="title">Title</option><option value="author">Author</option>
            </select></label><button type="button" data-action="clear-search">Clear search</button></div>
          </div></details>
        </div><span class="result-count"></span>
        </div>
        ${listControls}
        <div class="app-scroll" id="books-${option.id}" role="region" aria-label="${option.title} books"></div>
        <footer class="app-footer"><a href="index.html?view=library" target="_blank" rel="noopener noreferrer" title="Open reviewed full-library prototype with its own sample">Open full library</a><button type="button" data-action="import">Import</button></footer>
      </section>
    </article>`;
  }).join("");

  function visibleBooks(option) {
    const current = getState(option.id);
    const query = current.query.trim().toLocaleLowerCase("en");
    const visible = books.filter(book => getGroup(current.group).accepts(book) &&
      `${book.title} ${book.author}`.toLocaleLowerCase("en").includes(query));
    const order = current.order;
    if (!["recent", "title", "author"].includes(order)) throw new Error(`Unknown sort: ${order}`);
    return visible.sort((left, right) => order === "recent"
      ? right.opened - left.opened || collator.compare(left.title, right.title)
      : collator.compare(left[order], right[order]) || collator.compare(left.title, right.title));
  }
  function bookButton(book, tiles = false) {
    const current = book.id === resumeId && book.progress !== null && book.progress < 100;
    return `<li><button class="${tiles ? "book-tile" : "book-row"}" type="button" data-book-id="${book.id}" aria-label="Open ${escapeHtml(book.title)} by ${escapeHtml(book.author)}, ${progressText(book)} (prototype sample)">
      ${cover(book)}<span class="book-copy"><span class="book-title">${escapeHtml(book.title)}</span>
        ${tiles ? "" : `<span class="book-author">${escapeHtml(book.author)}</span>`}
        <span class="book-status${current ? " current-label" : ""}">${current ? "Continue · " : ""}${progressText(book)}</span>
        ${tiles ? "" : progress(book)}
      </span></button></li>`;
  }
  function emptyContent(current) {
    if (books.length === 0) return `<div class="empty"><h3>Your next chapter starts here.</h3><p>Add an original sample book to try this layout. No file will be read.</p><button class="primary" type="button" data-action="import">Import a sample book</button><br><a href="index.html?view=library&amp;discovery=open" target="_blank" rel="noopener noreferrer">Find books in the full preview</a></div>`;
    if (current.query.trim()) return `<div class="empty"><h3>No matching books</h3><p>Try another title or author, or clear the search.</p><button class="secondary" type="button" data-action="clear-search">Clear search</button></div>`;
    return `<div class="empty"><h3>Nothing in ${escapeHtml(getGroup(current.group).label)} yet</h3><p>Your other reading lists are still here.</p><button class="secondary" type="button" data-action="show-all">See all books</button></div>`;
  }
  function renderPanel(option) {
    const root = app(option.id);
    const current = getState(option.id);
    const visible = visibleBooks(option);
    const hasQuery = current.query.trim().length > 0;
    root.querySelector(".result-count").textContent =
      `${visible.length} ${hasQuery ? "matches" : "books"}${current.order === "recent" ? "" : ` · by ${current.order}`}`;
    root.querySelector(".tools").hidden = books.length === 0;
    root.querySelector(".app-footer [data-action='import']").hidden = books.length === 0;
    const lists = root.querySelector(".lists, .group-picker");
    lists.hidden = books.length === 0;
    for (const group of groups) {
      const count = books.filter(group.accepts).length;
      const button = root.querySelector(`[data-group="${group.id}"]`);
      if (button) {
        button.textContent = `${group.label} (${count})`;
        button.setAttribute("aria-pressed", String(current.group === group.id));
      }
      const choice = root.querySelector(`option[value="${group.id}"]`);
      if (choice) choice.textContent = `${group.label} (${count})`;
    }
    const picker = root.querySelector("[data-list]");
    if (picker) picker.value = current.group;
    const filter = hasQuery
      ? `<div class="filter-note"><span>Search: ${escapeHtml(current.query.trim())}</span><button type="button" data-action="clear-search">Clear</button></div>` : "";
    let content = visible.length === 0 ? emptyContent(current) : "";
    if (visible.length > 0 && option.id === "a") {
      const resume = !hasQuery && current.order === "recent"
        ? visible.find(book => book.id === resumeId && book.progress !== null && book.progress < 100)
        : undefined;
      const others = resume ? visible.filter(book => book.id !== resume.id) : visible;
      if (resume) content += `<div class="resume">${cover(resume)}<div><p class="eyebrow">Continue reading</p><strong>${escapeHtml(resume.title)}</strong><span class="book-author">${escapeHtml(resume.author)}</span><span class="book-status">${progressText(resume)}</span>${progress(resume)}<button class="primary" type="button" data-book-id="${resume.id}">Continue reading</button></div></div>`;
      if (others.length) content += `${resume ? '<p class="section-label">Also on this list</p>' : ""}<ul class="book-list">${others.map(book => bookButton(book)).join("")}</ul>`;
    } else if (visible.length > 0) {
      content = `<ul class="${option.id === "c" ? "cover-grid" : "book-list"}">${visible.map(book => bookButton(book, option.id === "c")).join("")}</ul>`;
    }
    root.querySelector(".app-scroll").innerHTML = filter + content;
  }
  const renderAll = () => options.forEach(renderPanel);
  function resetSample() {
    const scenario = required("#sample-scenario").value;
    const counts = { full: 8, small: 2, empty: 0 };
    if (!(scenario in counts)) throw new Error(`Unknown sample scenario: ${scenario}`);
    books = sourceBooks.slice(0, counts[scenario]).map(book => ({ ...book }));
    resumeId = "coast";
    imported = 0;
    opened = 10;
    for (const option of options) {
      state.set(option.id, { group: option.group, query: "", order: "recent" });
      required(`#query-${option.id}`).value = "";
      required(`#order-${option.id}`).value = "recent";
      required(`#tools-${option.id}`).open = false;
    }
    renderAll();
    announce("Sample reset. This does not affect your extension.");
  }
  function closeMenus() {
    document.querySelectorAll(".app-menu[open]").forEach(menu => { menu.open = false; });
  }
  function openDialog(title, html, trigger, bookId) {
    const root = trigger.closest(".app");
    dialogOrigin = { trigger, option: root?.dataset.option, bookId };
    closeMenus();
    required("#dialog-heading").textContent = title;
    required("#dialog-content").innerHTML = html;
    dialog.showModal();
  }
  function openBook(id, trigger) {
    const book = books.find(candidate => candidate.id === id);
    if (!book) throw new Error(`Unknown sample book: ${id}`);
    if (book.progress === null) book.progress = 0;
    book.opened = ++opened;
    if (book.progress < 100) resumeId = id;
    openDialog(`${book.title} — prototype sample`, `<p class="boundary">Original fictional sample prose below; not text from the selected work. No EPUB was opened. Resume choices update only in this study.</p>
      <div class="sample-prose"><p>On the quiet coast, the path changed with the weather. In the morning it followed the water; by evening, it seemed to follow the light.</p><p>A notebook lay open beside the window. There was room for one more observation, and no hurry to decide what it should be.</p></div>`, trigger, id);
    renderAll();
  }
  function setPalette(value) {
    if (!["ambra", "silver", "green", "blue", "purple"].includes(value)) {
      throw new Error(`Unknown palette: ${value}`);
    }
    document.documentElement.dataset.palette = value;
    required("#interface-theme").value = value;
  }
  function clearSearch(id) {
    const option = options.find(candidate => candidate.id === id);
    if (!option) throw new Error(`Unknown compact option: ${id}`);
    getState(id).query = "";
    required(`#query-${id}`).value = "";
    renderPanel(option);
    const tools = required(`#tools-${id}`);
    (tools.open ? required(`#query-${id}`) : tools.querySelector("summary")).focus();
    announce(`${option.title}: search cleared.`);
  }

  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest("[data-action], [data-book-id], [data-group]");
    if (!trigger) return;
    const root = trigger.closest(".app");
    const id = root?.dataset.option;
    if (trigger.dataset.bookId) return openBook(trigger.dataset.bookId, trigger);
    if (trigger.dataset.group) {
      getGroup(trigger.dataset.group);
      getState(id).group = trigger.dataset.group;
      renderPanel(options.find(option => option.id === id));
      return;
    }
    switch (trigger.dataset.action) {
      case "clear-search": clearSearch(id); break;
      case "show-all":
        getState(id).group = "all";
        renderPanel(options.find(option => option.id === id));
        app(id).querySelector("[data-group='all'], [data-list]").focus();
        break;
      case "settings":
        openDialog("Preview settings", `<label for="dialog-palette">Interface theme<select id="dialog-palette">${["ambra", "silver", "green", "blue", "purple"].map(palette => `<option value="${palette}"${palette === required("#interface-theme").value ? " selected" : ""}>${palette[0].toUpperCase() + palette.slice(1)}</option>`).join("")}</select></label><p>Light/dark appearance follows your browser. This study is English-only; no production setting changes.</p>`, trigger);
        break;
      case "help":
        openDialog("About this compact study", "<p>Choose a reading list, open a sample book, or use Find &amp; sort. Tab and Enter operate ordinary buttons; Escape closes disclosures and the dialog.</p><p>Import adds an original sample, not a real file. Full library and discovery links open the reviewed prototype with its separate sample.</p><p>These alternatives do not remove any production capability. Native popup/AT and localization validation remain required.</p>", trigger);
        break;
      case "import":
        openDialog("Import an original sample", '<p>No file picker or file access is used. Add a generated book to compare the layouts after an import.</p><button class="primary" type="button" data-action="add-sample">Add sample book</button>', trigger);
        break;
      case "add-sample":
        books.push({ id: `import-${++imported}`, title: `A New Chapter ${imported}`, author: "Ambra Sample Editions", label: "Original sample", color: "#40564e", progress: null, opened: 0 });
        options.forEach(option => {
          const current = getState(option.id);
          current.group = "all";
          current.query = "";
          required(`#query-${option.id}`).value = "";
        });
        renderAll();
        dialog.close();
        announce("Added an original sample book. No file was read or stored.");
        break;
      default: throw new Error(`Unknown study action: ${trigger.dataset.action}`);
    }
  });
  document.addEventListener("input", event => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches("[data-query]")) return;
    const id = target.dataset.query;
    getState(id).query = target.value;
    const option = options.find(candidate => candidate.id === id);
    renderPanel(option);
    announce(`${option.title}: ${visibleBooks(option).length} matching books.`);
  });
  document.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-order], [data-list]")) {
      const id = target.dataset.order ?? target.dataset.list;
      const current = getState(id);
      if (target.dataset.order) current.order = target.value;
      else { getGroup(target.value); current.group = target.value; }
      renderPanel(options.find(option => option.id === id));
    } else if (target.id === "interface-theme" || target.id === "dialog-palette") {
      setPalette(target.value);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || dialog.open || !(event.target instanceof Element)) return;
    const disclosure = event.target.closest("details[open]");
    if (disclosure) {
      event.preventDefault();
      disclosure.open = false;
      disclosure.querySelector("summary").focus();
    }
  });
  dialog.addEventListener("close", () => {
    const origin = dialogOrigin;
    if (!origin) throw new Error("Dialog closed without an originating control.");
    if (origin.bookId && origin.option) {
      const root = app(origin.option);
      const target = root.querySelector(`[data-book-id="${origin.bookId}"]`) ??
        root.querySelector("[data-group][aria-pressed='true'], [data-list]");
      if (!target) throw new Error("No focus return target after sample reading.");
      target.focus();
    } else if (origin.trigger.isConnected && !origin.trigger.hidden) {
      const menu = origin.trigger.closest(".app-menu");
      (menu ? menu.querySelector("summary") : origin.trigger).focus();
    } else if (origin.option) {
      app(origin.option).querySelector("[data-action='import']").focus();
    }
  });
  options.forEach(option => {
    required(`#tools-${option.id}`).addEventListener("toggle", event => {
      const open = event.target.open;
      if (open) required(`#query-${option.id}`).focus();
    });
  });
  required("#sample-scenario").addEventListener("change", resetSample);
  required("#reset-sample").addEventListener("click", resetSample);
  required("#preview-width").addEventListener("change", event => {
    const value = event.target.value;
    if (!["320", "360"].includes(value)) throw new Error(`Unknown preview width: ${value}`);
    document.documentElement.style.setProperty("--preview-width", `${value}px`);
  });
  const appearance = window.matchMedia("(prefers-color-scheme: dark)");
  const updateAppearance = () => {
    document.documentElement.dataset.theme = appearance.matches ? "dark" : "light";
    required("#appearance").textContent = `${appearance.matches ? "Dark" : "Light"} appearance follows your browser.`;
  };
  appearance.addEventListener("change", updateAppearance);
  updateAppearance();
  setPalette("ambra");
  resetSample();
})();
