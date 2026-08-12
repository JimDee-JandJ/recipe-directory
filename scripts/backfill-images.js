#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const RECIPES_PATH = path.join(__dirname, "..", "assets", "data", "recipes.json");
const IMG_DIR = path.join(__dirname, "..", "assets", "img");

const API_KEY = process.env.PEXELS_API_KEY;
const BATCH_CAP = 150; // ceiling on recipes attempted per run; the rate-limit check below is the real stop condition

function setOutput(name, value) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, name + "=" + value + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Generic descriptor words are deliberately excluded from relevance checks — "bbq" or "honey"
// matching a loosely-related photo's description isn't good enough evidence of a real match.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "n", "with", "style", "high", "protein", "low", "carb", "fat", "free",
  "mini", "easy", "best", "of", "in", "for", "to", "ultimate", "creamy", "crispy", "sticky", "spicy",
  "healthy", "quick", "simple", "classic", "homemade", "loaded", "cheesy", "honey", "bbq", "sweet",
  "sour", "hot", "garlic", "lemon", "smoky", "smoked", "grilled", "baked", "roasted", "fresh",
]);

// Ordered longest/most specific first so matching is greedy toward the more distinctive phrase.
// All entries use "and" (never "&" or "n") — normalizeDishText() below rewrites both the title
// and each candidate photo's description into this same spelling before matching either.
const DISH_KEYWORDS = [
  "mac and cheese", "fried rice", "rice bowl", "burrito bowl", "power bowl", "buddha bowl",
  "stir fry", "spring rolls", "sheet pan", "overnight oats", "protein pancakes", "protein waffles",
  "egg muffins", "energy balls", "protein balls", "protein bars", "banana bread", "chicken wings",
  "loaded fries", "sweet potato", "shepherds pie", "cottage pie", "chow mein", "pad thai", "curry",
  "tacos", "taco", "burrito", "quesadilla", "wraps", "wrap", "salad", "soup", "stew", "chilli",
  "chili", "burgers", "burger", "pizza", "sandwich", "bagel", "omelette", "omelet", "pancakes",
  "waffles", "oats", "noodles", "pasta", "risotto", "paella", "casserole", "meatballs", "kebabs",
  "kebab", "skewers", "nachos", "enchiladas", "fajitas", "biryani", "shawarma", "gyro", "cake",
  "cookies", "brownies", "donuts", "muffins", "smoothie", "bowl",
];

function normalizeDishText(s) {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bn\b/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractKeywords(title) {
  return normalizeDishText(title)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function findDishType(title) {
  const normalized = normalizeDishText(title);
  return DISH_KEYWORDS.find((phrase) => normalized.includes(phrase)) || null;
}

// Photo descriptions tend to use the full/formal name of a dish even when the recipe title
// uses a colloquial short form (e.g. a stock photo says "macaroni and cheese", never "mac and
// cheese"), so relevance checks need to accept either spelling.
const DISH_SYNONYMS = {
  "mac and cheese": ["mac and cheese", "macaroni and cheese"],
  fajitas: ["fajitas", "fajita"],
  enchiladas: ["enchiladas", "enchilada"],
  kebabs: ["kebabs", "kebab", "skewers"],
  meatballs: ["meatballs", "meatball"],
};

function containsPhrase(text, phrase) {
  const variants = DISH_SYNONYMS[phrase] || [phrase];
  return variants.some((v) => new RegExp("\\b" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text));
}

// Relevance requires the dish-defining term itself (e.g. "mac and cheese") in the photo's
// description — not just any keyword — since generic words alone let unrelated photos through.
// Titles with no recognized dish type fall back to requiring the last significant word (usually
// the core noun, e.g. "chicken" in "High Protein Creamy Chicken").
function isRelevant(photo, title, dishType, keywords) {
  const alt = normalizeDishText(photo.alt || "");
  if (!alt) return false;
  if (dishType) return containsPhrase(alt, dishType);
  const anchor = keywords[keywords.length - 1];
  return anchor ? containsPhrase(alt, anchor) : false;
}

function searchPhotos(query) {
  return new Promise((resolve, reject) => {
    const url = "https://api.pexels.com/v1/search?per_page=5&orientation=landscape&query=" + encodeURIComponent(query);
    https
      .get(url, { headers: { Authorization: API_KEY } }, (res) => {
        const remaining = parseInt(res.headers["x-ratelimit-remaining"], 10);
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 429) {
            return reject(new Error("RATE_LIMITED"));
          }
          if (res.statusCode !== 200) {
            return resolve({ photos: [], remaining });
          }
          try {
            const json = JSON.parse(body);
            resolve({ photos: json.photos || [], remaining });
          } catch (e) {
            resolve({ photos: [], remaining });
          }
        });
      })
      .on("error", () => resolve({ photos: [], remaining: NaN }));
  });
}

function photoUrlOf(photo) {
  return photo.src.large || photo.src.medium || photo.src.original;
}

// Tries the full title first; if none of the results' descriptions actually mention the
// recipe's key terms (e.g. a "BBQ platter" photo for "Honey BBQ Chicken Mac & Cheese"),
// retries with just the base dish type ("mac and cheese") pulled from DISH_KEYWORDS.
async function findBestPhoto(title) {
  const keywords = extractKeywords(title);
  const dishType = findDishType(title);
  let lastRemaining = NaN;

  const primary = await searchPhotos(title + " food");
  lastRemaining = primary.remaining;
  let relevant = primary.photos.find((p) => isRelevant(p, title, dishType, keywords));
  if (relevant) return { photoUrl: photoUrlOf(relevant), remaining: lastRemaining };

  if (dishType) {
    const fallback = await searchPhotos(dishType + " food");
    lastRemaining = Number.isNaN(fallback.remaining) ? lastRemaining : fallback.remaining;
    relevant = fallback.photos.find((p) => isRelevant(p, title, dishType, keywords)) || fallback.photos[0];
    if (relevant) return { photoUrl: photoUrlOf(relevant), remaining: lastRemaining };
  }

  const best = primary.photos[0];
  return { photoUrl: best ? photoUrlOf(best) : null, remaining: lastRemaining };
}

function downloadImage(imgUrl, destPath) {
  return new Promise((resolve) => {
    https
      .get(imgUrl, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(false);
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(true)));
      })
      .on("error", () => resolve(false));
  });
}

async function main() {
  if (!API_KEY) {
    console.error("PEXELS_API_KEY is not set — add it as a repo secret before running this workflow.");
    setOutput("updated", "false");
    process.exit(1);
  }

  const recipes = JSON.parse(fs.readFileSync(RECIPES_PATH, "utf8"));
  const missing = recipes.filter((r) => r.image === "placeholder.jpg").slice(0, BATCH_CAP);

  console.log("Found " + missing.length + " recipes to backfill this run (of the full remaining set).");

  let updated = 0;
  let skipped = 0;

  for (const recipe of missing) {
    let result;
    try {
      result = await findBestPhoto(recipe.title);
    } catch (e) {
      if (e.message === "RATE_LIMITED") {
        console.log("Hit Pexels rate limit — stopping early. Re-run the workflow later for the rest.");
        break;
      }
      skipped++;
      continue;
    }

    if (!result.photoUrl) {
      console.log("No photo found for: " + recipe.title);
      skipped++;
    } else {
      const destName = recipe.id + ".jpg";
      const ok = await downloadImage(result.photoUrl, path.join(IMG_DIR, destName));
      if (ok) {
        recipe.image = destName;
        updated++;
        console.log("Updated: " + recipe.title);
      } else {
        console.log("Download failed for: " + recipe.title);
        skipped++;
      }
    }

    if (!Number.isNaN(result.remaining) && result.remaining <= 5) {
      console.log("Approaching Pexels rate limit (remaining=" + result.remaining + ") — stopping early.");
      break;
    }

    await sleep(350);
  }

  if (updated > 0) {
    fs.writeFileSync(RECIPES_PATH, JSON.stringify(recipes, null, 1) + "\n");
  }

  console.log("Done. Updated: " + updated + ", skipped: " + skipped + ".");
  setOutput("updated", updated > 0 ? "true" : "false");
  setOutput("count", String(updated));
}

main();
