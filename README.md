# Recipe Directory

A filterable, searchable directory of high-protein recipes with full macro breakdowns, photos, ingredients, and directions — built from the Frozen Food Aisle Favorites, Set It & Shred It Vol. 1, Shred Donuts, and Meal Prepped cookbooks.

- `index.html` — the recipe grid, with filters by protein type, meal type, and cookbook, plus search.
- `submit.html` — a form for submitting new recipes found on Instagram/the web to be added later.
- `assets/data/recipes.json` — all recipe data (edit this, or ask Claude to add new entries here).
- `assets/img/` — recipe photos.

## Publishing with GitHub Pages

A workflow at `.github/workflows/pages.yml` deploys this repo to GitHub Pages automatically on every push to `main`. To turn it on:

1. Go to **Settings → Pages** in this repository.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or re-run the workflow) — the site will be live at `https://<username>.github.io/recipe-directory/`.
