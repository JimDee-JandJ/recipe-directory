# Recipe Directory

A filterable, searchable directory of high-protein recipes with full macro breakdowns, photos, ingredients, and directions — built from five cookbooks: Frozen Food Aisle Favorites, Set It & Shred It Vol. 1, Shred Donuts, Meal Prepped, and Tasty Shreds Jan-Feb-March.

- `index.html` — the recipe grid, with filters by protein type (Beef/Chicken/Turkey/Pork/Mixed/Sweet), meal type, and cookbook, plus search and macro range filters (e.g. 50g+ protein, under 20g fat).
- `submit.html` — a form for submitting new recipes found on Instagram/the web to be added later.
- `assets/data/recipes.json` — all recipe data (edit this, or ask Claude to add new entries here).
- `assets/img/` — recipe photos. Recipes from "Tasty Shreds Jan-Feb-March" currently use a placeholder image (`placeholder.jpg`) since photos haven't been extracted for that book yet.

## Publishing with GitHub Pages

1. Go to **Settings → Pages** in this repository.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Set branch to **main**, folder to **/ (root)**, and click **Save**.
4. The site will be live at `https://<username>.github.io/recipe-directory/` within a minute or two.
