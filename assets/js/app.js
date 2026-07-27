(function () {
  "use strict";

  var PROTEIN_LABELS = { beef: "Beef", chicken: "Chicken", turkey: "Turkey", pork: "Pork", mixed: "Mixed", sweet: "Sweet", fish: "Fish", vegetarian: "Vegetarian", vegan: "Vegan" };
  var MEAL_LABELS = { entree: "Main", breakfast: "Breakfast", snack: "Snack", dessert: "Dessert" };

  var MACRO_FIELDS = [
    { key: "calories", label: "Calories", unit: "" },
    { key: "proteinG", label: "Protein", unit: "g" },
    { key: "carbsG", label: "Carbs", unit: "g" },
    { key: "fatG", label: "Fat", unit: "g" },
  ];

  var state = {
    recipes: [],
    query: "",
    protein: "all",
    meal: "all",
    book: "all",
    macro: {
      calories: { min: null, max: null },
      proteinG: { min: null, max: null },
      carbsG: { min: null, max: null },
      fatG: { min: null, max: null },
    },
    unit: "oz",
  };

  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var OZ_REGEX = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?[\s-]*(?:oz|ounces?)\.?(?!\w)/gi;

  function ozToGrams(text) {
    return text.replace(OZ_REGEX, function (match, n1, n2) {
      var g1 = Math.round(parseFloat(n1) * 28.3495);
      if (n2 !== undefined) {
        var g2 = Math.round(parseFloat(n2) * 28.3495);
        return g1 + "-" + g2 + "g";
      }
      return g1 + "g";
    });
  }

  function macroPill(label, val, unit) {
    if (val === null || val === undefined) return "";
    return '<span class="macro-pill"><b>' + esc(val) + (unit || "") + "</b> " + esc(label) + "</span>";
  }

  function cardTemplate(r) {
    var mealTag = r.meal ? '<span class="tag tag-meal-' + esc(r.meal) + '">' + esc(MEAL_LABELS[r.meal] || r.meal) + "</span>" : "";
    var proteinTag = '<span class="tag tag-' + esc(r.protein) + '">' + esc(PROTEIN_LABELS[r.protein] || r.protein) + "</span>";
    var macros = [
      r.calories !== null ? macroPill("cal", r.calories) : "",
      r.proteinG !== null ? macroPill("protein", r.proteinG, "g") : "",
      r.carbsG !== null ? macroPill("carbs", r.carbsG, "g") : "",
      r.fatG !== null ? macroPill("fat", r.fatG, "g") : "",
    ].join("");
    var time = r.cook && r.cook !== r.prep ? r.cook : r.prep;
    return (
      '<a class="card" href="#/recipe/' + esc(r.id) + '" data-id="' + esc(r.id) + '">' +
      '<div class="card-img-wrap"><img loading="lazy" src="assets/img/' + esc(r.image) + '" alt="' + esc(r.title) + '">' +
      '<div class="card-tags">' + proteinTag + mealTag + "</div>" +
      "</div>" +
      '<div class="card-body">' +
      '<p class="card-title">' + esc(r.title) + "</p>" +
      '<p class="card-book">' + esc(r.book) + "</p>" +
      '<div class="card-meta">' +
      (r.yieldText ? "<span>🍽️ " + esc(r.yieldText) + "</span>" : "") +
      (time ? "<span>⏱ " + esc(time) + "</span>" : "") +
      "</div>" +
      '<div class="card-macros">' + macros + "</div>" +
      "</div>" +
      "</a>"
    );
  }

  function matches(r) {
    if (state.protein !== "all" && r.protein !== state.protein) return false;
    if (state.meal !== "all" && r.meal !== state.meal) return false;
    if (state.book !== "all" && r.book !== state.book) return false;
    if (state.query) {
      var q = state.query.toLowerCase();
      var hay = (r.title + " " + r.ingredients.join(" ") + " " + r.book).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    for (var i = 0; i < MACRO_FIELDS.length; i++) {
      var key = MACRO_FIELDS[i].key;
      var range = state.macro[key];
      if (range.min === null && range.max === null) continue;
      var val = r[key];
      if (val === null || val === undefined) return false;
      if (range.min !== null && val < range.min) return false;
      if (range.max !== null && val > range.max) return false;
    }
    return true;
  }

  function renderGrid() {
    var grid = document.getElementById("grid");
    var countEl = document.getElementById("resultCount");
    if (!grid) return;
    var filtered = state.recipes.filter(matches);
    countEl.textContent = filtered.length + (filtered.length === 1 ? " recipe" : " recipes");
    if (filtered.length === 0) {
      grid.innerHTML = "";
      grid.insertAdjacentHTML(
        "afterend",
        '<div class="empty-state" id="emptyState"><h3>No recipes match</h3><p>Try clearing a filter or search term.</p></div>'
      );
      return;
    }
    var existingEmpty = document.getElementById("emptyState");
    if (existingEmpty) existingEmpty.remove();
    grid.innerHTML = filtered.map(cardTemplate).join("");
  }

  function buildChipGroup(containerId, options, current, onPick) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = options
      .map(function (opt) {
        var active = opt.value === current ? " active" : "";
        return '<button type="button" class="chip' + active + '" data-value="' + esc(opt.value) + '">' + esc(opt.label) + "</button>";
      })
      .join("");
    el.querySelectorAll(".chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        onPick(btn.getAttribute("data-value"));
        el.querySelectorAll(".chip").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        renderGrid();
      });
    });
  }

  function initFilters() {
    var proteinCounts = {};
    var mealCounts = {};
    var bookSet = {};
    state.recipes.forEach(function (r) {
      proteinCounts[r.protein] = (proteinCounts[r.protein] || 0) + 1;
      mealCounts[r.meal] = (mealCounts[r.meal] || 0) + 1;
      bookSet[r.book] = true;
    });

    var proteinOpts = [{ value: "all", label: "All" }].concat(
      Object.keys(PROTEIN_LABELS)
        .filter(function (k) { return proteinCounts[k]; })
        .map(function (k) { return { value: k, label: PROTEIN_LABELS[k] + " (" + proteinCounts[k] + ")" }; })
    );
    var mealOpts = [{ value: "all", label: "All" }].concat(
      Object.keys(MEAL_LABELS)
        .filter(function (k) { return mealCounts[k]; })
        .map(function (k) { return { value: k, label: MEAL_LABELS[k] + " (" + mealCounts[k] + ")" }; })
    );
    var bookOpts = [{ value: "all", label: "All books" }].concat(
      Object.keys(bookSet).map(function (b) { return { value: b, label: b }; })
    );

    buildChipGroup("proteinChips", proteinOpts, state.protein, function (v) { state.protein = v; });
    buildChipGroup("mealChips", mealOpts, state.meal, function (v) { state.meal = v; });
    buildChipGroup("bookChips", bookOpts, state.book, function (v) { state.book = v; });

    var searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        state.query = searchInput.value.trim();
        renderGrid();
      });
    }

    MACRO_FIELDS.forEach(function (f) {
      var minEl = document.getElementById("macroMin_" + f.key);
      var maxEl = document.getElementById("macroMax_" + f.key);
      if (!minEl || !maxEl) return;
      minEl.value = state.macro[f.key].min === null ? "" : state.macro[f.key].min;
      maxEl.value = state.macro[f.key].max === null ? "" : state.macro[f.key].max;
      minEl.addEventListener("input", function () {
        state.macro[f.key].min = minEl.value === "" ? null : Number(minEl.value);
        renderGrid();
      });
      maxEl.addEventListener("input", function () {
        state.macro[f.key].max = maxEl.value === "" ? null : Number(maxEl.value);
        renderGrid();
      });
    });

    var clearMacroBtn = document.getElementById("clearMacroFilters");
    if (clearMacroBtn) {
      clearMacroBtn.addEventListener("click", function () {
        MACRO_FIELDS.forEach(function (f) {
          state.macro[f.key] = { min: null, max: null };
          var minEl = document.getElementById("macroMin_" + f.key);
          var maxEl = document.getElementById("macroMax_" + f.key);
          if (minEl) minEl.value = "";
          if (maxEl) maxEl.value = "";
        });
        renderGrid();
      });
    }
  }

  function macroBasis(r) {
    return "As listed in " + r.book + (r.yieldText ? " — yield: " + r.yieldText : "");
  }

  function renderDetail(id) {
    var r = state.recipes.find(function (x) { return x.id === id; });
    var main = document.getElementById("app");
    if (!r) {
      main.innerHTML = '<div class="empty-state"><h3>Recipe not found</h3><a class="btn" href="#/">Back to directory</a></div>';
      return;
    }
    document.title = r.title + " · Recipe Directory";
    var mealTag = r.meal ? '<span class="tag tag-meal-' + esc(r.meal) + '">' + esc(MEAL_LABELS[r.meal] || r.meal) + "</span>" : "";
    var proteinTag = '<span class="tag tag-' + esc(r.protein) + '">' + esc(PROTEIN_LABELS[r.protein] || r.protein) + "</span>";

    var macroCells = ["calories", "proteinG", "carbsG", "fatG"]
      .map(function (key, i) {
        var labels = ["Calories", "Protein", "Carbs", "Fat"];
        var units = ["", "g", "g", "g"];
        var v = r[key];
        return '<div class="cell"><div class="val">' + (v === null || v === undefined ? "—" : esc(v) + units[i]) + '</div><div class="lbl">' + labels[i] + "</div></div>";
      })
      .join("");

    var convert = state.unit === "g" ? ozToGrams : function (s) { return s; };
    var ingredientsHtml = r.ingredients.map(function (i) { return "<li>" + esc(convert(i)) + "</li>"; }).join("");
    var stepsHtml = r.instructions.map(function (s) { return "<li>" + esc(convert(s)) + "</li>"; }).join("");
    var unitToggleLabel = state.unit === "g" ? "Show oz" : "Show grams";

    main.innerHTML =
      '<div class="wrap">' +
      '<a class="detail-back" href="#/">&larr; Back to all recipes</a>' +
      '<div class="detail-hero">' +
      '<img src="assets/img/' + esc(r.image) + '" alt="' + esc(r.title) + '">' +
      '<div class="detail-info">' +
      '<div class="detail-tags">' + proteinTag + mealTag + "</div>" +
      "<h1>" + esc(r.title) + "</h1>" +
      '<div class="detail-meta-row">' +
      "<span>📚 " + esc(r.book) + "</span>" +
      (r.yieldText ? "<span>🍽️ " + esc(r.yieldText) + "</span>" : "") +
      (r.prep ? "<span>🔪 Prep: " + esc(r.prep) + "</span>" : "") +
      (r.cook ? "<span>⏱ Cook: " + esc(r.cook) + "</span>" : "") +
      "</div>" +
      '<div class="macro-table">' + macroCells + "</div>" +
      '<div class="macro-basis">' + esc(macroBasis(r)) + "</div>" +
      (r.macroNote ? '<div class="macro-note">' + esc(r.macroNote) + "</div>" : "") +
      "</div>" +
      "</div>" +
      '<div class="detail-columns">' +
      '<div><h2>Ingredients <button type="button" id="unitToggle" class="link-btn">' + esc(unitToggleLabel) + "</button></h2>" +
      '<ul class="ingredient-list">' + ingredientsHtml + "</ul></div>" +
      "<div><h2>Directions</h2><ol class=\"step-list\">" + stepsHtml + "</ol></div>" +
      "</div>" +
      "</div>";
    window.scrollTo(0, 0);

    var unitToggle = document.getElementById("unitToggle");
    if (unitToggle) {
      unitToggle.addEventListener("click", function () {
        state.unit = state.unit === "g" ? "oz" : "g";
        renderDetail(id);
      });
    }
  }

  function renderDirectory() {
    document.title = "Recipe Directory";
    var main = document.getElementById("app");
    main.innerHTML =
      '<div class="wrap hero">' +
      "<h1>The Recipe Directory</h1>" +
      "<p>Every high-protein recipe in one place — filter by protein or meal type, dial in a macro range (e.g. 50g+ protein, under 20g fat), and open any card for full ingredients and directions.</p>" +
      "</div>" +
      '<div class="wrap controls">' +
      '<div class="search-row"><div class="search-box">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
      '<input id="searchInput" type="search" placeholder="Search recipes or ingredients…" autocomplete="off">' +
      "</div></div>" +
      '<div class="filter-groups">' +
      '<div class="filter-group"><div class="fg-label">Protein</div><div class="chip-row" id="proteinChips"></div></div>' +
      '<div class="filter-group"><div class="fg-label">Meal type</div><div class="chip-row" id="mealChips"></div></div>' +
      '<div class="filter-group"><div class="fg-label">Cookbook</div><div class="chip-row" id="bookChips"></div></div>' +
      "</div>" +
      '<div class="macro-filters">' +
      '<div class="fg-label">Macros (per listed serving) <button type="button" id="clearMacroFilters" class="link-btn">clear</button></div>' +
      '<div class="macro-filter-row">' +
      MACRO_FIELDS.map(function (f) {
        return (
          '<div class="macro-filter">' +
          '<span class="macro-filter-label">' + esc(f.label) + (f.unit ? " (" + f.unit + ")" : "") + "</span>" +
          '<div class="macro-filter-inputs">' +
          '<input type="number" inputmode="numeric" min="0" placeholder="min" id="macroMin_' + f.key + '">' +
          "<span>–</span>" +
          '<input type="number" inputmode="numeric" min="0" placeholder="max" id="macroMax_' + f.key + '">' +
          "</div>" +
          "</div>"
        );
      }).join("") +
      "</div>" +
      "</div>" +
      '<div class="result-count" id="resultCount"></div>' +
      "</div>" +
      '<div class="wrap"><div class="grid" id="grid"></div></div>';
    initFilters();
    renderGrid();
  }

  function route() {
    var hash = window.location.hash || "#/";
    var m = hash.match(/^#\/recipe\/(.+)$/);
    if (m) {
      renderDetail(decodeURIComponent(m[1]));
    } else {
      renderDirectory();
    }
  }

  function boot() {
    fetch("assets/data/recipes.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.recipes = data.sort(function (a, b) { return a.title.localeCompare(b.title); });
        route();
        window.addEventListener("hashchange", route);
      })
      .catch(function (err) {
        document.getElementById("app").innerHTML =
          '<div class="wrap"><div class="empty-state"><h3>Could not load recipes</h3><p>' + esc(err.message) + "</p></div></div>";
      });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
