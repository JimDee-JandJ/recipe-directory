#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const RECIPES_PATH = path.join(__dirname, "..", "assets", "data", "recipes.json");
const IMG_DIR = path.join(__dirname, "..", "assets", "img");

const API_KEY = process.env.PEXELS_API_KEY;
const BATCH_CAP = 180; // stays under Pexels' 200 requests/hour free-tier limit with a safety buffer

function setOutput(name, value) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, name + "=" + value + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function searchPhoto(query) {
  return new Promise((resolve, reject) => {
    const url = "https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=" + encodeURIComponent(query);
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
            return resolve({ photoUrl: null, remaining });
          }
          try {
            const json = JSON.parse(body);
            const photo = json.photos && json.photos[0];
            const photoUrl = photo ? (photo.src.large || photo.src.medium || photo.src.original) : null;
            resolve({ photoUrl, remaining });
          } catch (e) {
            resolve({ photoUrl: null, remaining });
          }
        });
      })
      .on("error", () => resolve({ photoUrl: null, remaining: NaN }));
  });
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
      result = await searchPhoto(recipe.title + " food");
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
