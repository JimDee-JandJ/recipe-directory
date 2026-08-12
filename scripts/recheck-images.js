#!/usr/bin/env node
"use strict";

// One-time pass to re-validate the 179 images picked by the first backfill-images.js run,
// before it had the relevance check added. Any recipe id in recheck-ids.json whose current
// photo doesn't hold up against the (now stricter) matching logic gets replaced, or reverted
// to the placeholder if no relevant photo can be found at all. Safe to re-run repeatedly:
// progress is tracked in recheck-progress.json so each run only processes what's left.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { extractKeywords, findDishType, isRelevant } = require("./lib/dish-matcher");

const RECIPES_PATH = path.join(__dirname, "..", "assets", "data", "recipes.json");
const IMG_DIR = path.join(__dirname, "..", "assets", "img");
const SEED_IDS_PATH = path.join(__dirname, "recheck-ids.json");
const PROGRESS_PATH = path.join(__dirname, "recheck-progress.json");

const API_KEY = process.env.PEXELS_API_KEY;
const BATCH_CAP = 150;

function setOutput(name, value) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, name + "=" + value + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    relevant = fallback.photos.find((p) => isRelevant(p, title, dishType, keywords));
    if (relevant) return { photoUrl: photoUrlOf(relevant), remaining: lastRemaining };
  }

  // Unlike the main backfill script, no last-resort fallback to an unverified top result here —
  // this pass exists specifically to remove unverified matches, not add new ones.
  return { photoUrl: null, remaining: lastRemaining };
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

  const seedIds = JSON.parse(fs.readFileSync(SEED_IDS_PATH, "utf8"));
  const progress = fs.existsSync(PROGRESS_PATH) ? JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")) : [];
  const progressSet = new Set(progress);
  const remainingIds = seedIds.filter((id) => !progressSet.has(id)).slice(0, BATCH_CAP);

  console.log("Rechecking " + remainingIds.length + " of " + (seedIds.length - progress.length) + " remaining recipes.");

  const recipes = JSON.parse(fs.readFileSync(RECIPES_PATH, "utf8"));
  const byId = new Map(recipes.map((r) => [r.id, r]));

  let replaced = 0;
  let reverted = 0;
  let kept = 0;
  let processedIds = [];

  for (const id of remainingIds) {
    const recipe = byId.get(id);
    if (!recipe) {
      processedIds.push(id); // no longer exists in recipes.json — nothing to do
      continue;
    }

    let result;
    try {
      result = await findBestPhoto(recipe.title);
    } catch (e) {
      if (e.message === "RATE_LIMITED") {
        console.log("Hit Pexels rate limit — stopping early. Re-run the workflow later for the rest.");
        break;
      }
      processedIds.push(id);
      continue;
    }

    if (!result.photoUrl) {
      recipe.image = "placeholder.jpg";
      const oldFile = path.join(IMG_DIR, id + ".jpg");
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      reverted++;
      console.log("Reverted to placeholder (no relevant match found): " + recipe.title);
    } else {
      const destName = id + ".jpg";
      const ok = await downloadImage(result.photoUrl, path.join(IMG_DIR, destName));
      if (ok) {
        recipe.image = destName;
        replaced++;
        console.log("Replaced with a verified match: " + recipe.title);
      } else {
        kept++;
        console.log("Download failed, keeping existing image: " + recipe.title);
      }
    }

    processedIds.push(id);

    if (!Number.isNaN(result.remaining) && result.remaining <= 5) {
      console.log("Approaching Pexels rate limit (remaining=" + result.remaining + ") — stopping early.");
      break;
    }

    await sleep(350);
  }

  const changed = replaced + reverted;
  if (changed > 0) {
    fs.writeFileSync(RECIPES_PATH, JSON.stringify(recipes, null, 1) + "\n");
  }

  const newProgress = progress.concat(processedIds);
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(newProgress, null, 1) + "\n");

  const done = newProgress.length >= seedIds.length;
  console.log(
    "Done. Replaced: " + replaced + ", reverted: " + reverted + ", kept: " + kept +
      ". Progress: " + newProgress.length + "/" + seedIds.length + (done ? " (complete)" : "")
  );
  setOutput("changed", changed > 0 || processedIds.length > 0 ? "true" : "false");
  setOutput("replaced", String(replaced));
  setOutput("reverted", String(reverted));
}

main();
