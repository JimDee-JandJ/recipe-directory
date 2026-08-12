#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const RECIPES_PATH = path.join(__dirname, "..", "assets", "data", "recipes.json");
const IMG_DIR = path.join(__dirname, "..", "assets", "img");

const url = (process.env.INSTAGRAM_URL || "").trim();
const caption = (process.env.CAPTION || "").trim();
const imageUrl = (process.env.IMAGE_URL || "").trim();

function setOutput(name, value) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, name + "=" + value + "\n");
}

function fail(reason) {
  console.error("Not adding recipe: " + reason);
  setOutput("added", "false");
  process.exit(1);
}

if (!caption || caption.length < 40) {
  fail(
    "caption was empty or too short to be a recipe (got " + caption.length +
      " chars) — Instagram's description likely didn't include the full caption for this post."
  );
}

// ---- section splitting ----
const HEADING_PATTERNS = {
  ingredients: /ingredients?\s*[:\-]?\s*$/im,
  instructions: /(instructions?|directions?|method|how to make|steps?)\s*[:\-]?\s*$/im,
  macros: /(macros?|nutrition)\s*[:\-]?\s*(per serving)?\s*[:\-]?\s*$/im,
};

const lines = caption.split(/\r?\n/).map((l) => l.trim());

function findHeadingIndex(re) {
  return lines.findIndex((l) => re.test(l));
}

const ingIdx = findHeadingIndex(HEADING_PATTERNS.ingredients);
const insIdx = findHeadingIndex(HEADING_PATTERNS.instructions);
const macIdx = findHeadingIndex(HEADING_PATTERNS.macros);

function sliceSection(startIdx) {
  if (startIdx === -1) return [];
  const boundaries = [ingIdx, insIdx, macIdx].filter((i) => i > startIdx);
  const endIdx = boundaries.length ? Math.min(...boundaries) : lines.length;
  return lines.slice(startIdx + 1, endIdx);
}

const BULLET_RE = /^[\-*•◦▪▫‣⁃✅🔸🔹]+\s*/;
const NUMBERED_RE = /^\(?\d+[.)]\s*/;
const KEYCAP_NUMBERED_RE = /^[0-9]️?⃣\s*/; // e.g. 1️⃣ 2️⃣ 3️⃣

const HASHTAG_ONLY_RE = /^(#\S+\s*)+$/;

function stripListMarker(l) {
  return l.replace(BULLET_RE, "").replace(NUMBERED_RE, "").replace(KEYCAP_NUMBERED_RE, "").trim();
}

function cleanListLines(raw) {
  return raw.map(stripListMarker).filter((l) => l.length > 0 && !HASHTAG_ONLY_RE.test(l));
}

let ingredients = cleanListLines(sliceSection(ingIdx));

// Fallback: no explicit "Ingredients" heading — try bullet lines anywhere before instructions/macros
if (ingredients.length === 0) {
  const cutoff = [insIdx, macIdx].filter((i) => i > -1);
  const end = cutoff.length ? Math.min(...cutoff) : lines.length;
  ingredients = cleanListLines(lines.slice(0, end).filter((l) => BULLET_RE.test(l)));
}

let instructions = cleanListLines(sliceSection(insIdx));

// Fallback: no explicit instructions heading — try numbered lines anywhere after ingredients
if (instructions.length === 0) {
  const start = ingIdx > -1 ? ingIdx : 0;
  instructions = cleanListLines(
    lines.slice(start).filter((l) => NUMBERED_RE.test(l) || KEYCAP_NUMBERED_RE.test(l))
  );
}

if (ingredients.length === 0 && instructions.length === 0) {
  fail("couldn't find an ingredients list or numbered steps in the caption — add this one manually via submit.html instead.");
}

// ---- title ----
function guessTitle() {
  for (const l of lines) {
    if (!l) continue;
    if (
      HEADING_PATTERNS.ingredients.test(l) ||
      HEADING_PATTERNS.instructions.test(l) ||
      HEADING_PATTERNS.macros.test(l)
    ) {
      break;
    }
    const stripped = l
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
      .replace(/#\w+/g, "")
      .trim();
    if (stripped.length >= 3) return stripped.replace(/[.!]+$/, "");
  }
  return "Untitled Instagram Recipe";
}
const title = guessTitle();

// ---- macros ----
function matchNum(re) {
  const m = caption.match(re);
  return m ? parseInt(m[1], 10) : null;
}
const calories = matchNum(/(\d{2,4})\s*(?:kcal|cal|calories)\b/i);
const proteinG = matchNum(/(\d{1,3})\s*g\s*protein/i) || matchNum(/protein[:\s]+(\d{1,3})\s*g/i);
const carbsG = matchNum(/(\d{1,3})\s*g\s*carb/i) || matchNum(/carbs?[:\s]+(\d{1,3})\s*g/i);
const fatG = matchNum(/(\d{1,3})\s*g\s*fat/i) || matchNum(/fat[:\s]+(\d{1,3})\s*g/i);

function matchYield() {
  const m = caption.match(/(?:serves|servings?|yields?)\s*[:\-]?\s*(\d+)/i);
  return m ? m[1] + " servings" : null;
}
const yieldText = matchYield();

// ---- protein / meal category guess ----
const haystack = (title + " " + caption).toLowerCase();
function has() {
  return Array.prototype.slice
    .call(arguments)
    .some((w) => new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(haystack));
}

let protein = "mixed";
if (has("chicken")) protein = "chicken";
else if (has("beef", "steak", "ground beef")) protein = "beef";
else if (has("turkey")) protein = "turkey";
else if (has("pork", "bacon", "ham")) protein = "pork";
else if (has("shrimp", "salmon", "tuna", "fish", "cod", "tilapia")) protein = "fish";
else if (has("tofu", "vegan")) protein = "vegan";
else if (has("cake", "cookie", "brownie", "donut", "dessert", "ice cream")) protein = "sweet";
else if (has("cheese", "egg", "pasta", "vegetable", "veggie")) protein = "vegetarian";

let meal = "entree";
if (has("breakfast", "pancake", "oats", "omelette", "overnight oats")) meal = "breakfast";
else if (has("dessert", "brownie", "cookie", "cake", "donut")) meal = "dessert";
else if (has("snack", "protein ball", "protein bar")) meal = "snack";

// ---- id / slug ----
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const recipes = JSON.parse(fs.readFileSync(RECIPES_PATH, "utf8"));

if (url && recipes.some((r) => r.source === url)) {
  fail("this Instagram post was already added (source URL already in recipes.json).");
}

const existingIds = new Set(recipes.map((r) => r.id));
const baseId = slugify(title) || "instagram-recipe";
let id = baseId;
let n = 2;
while (existingIds.has(id)) {
  id = baseId + "-" + n;
  n++;
}

// ---- image download ----
function downloadImage(imgUrl, destPath) {
  return new Promise((resolve) => {
    if (!imgUrl) return resolve(false);
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
  let image = "placeholder.jpg";
  if (imageUrl) {
    const destName = id + ".jpg";
    const ok = await downloadImage(imageUrl, path.join(IMG_DIR, destName));
    if (ok) image = destName;
  }

  const recipe = {
    id,
    title,
    book: "Instagram",
    protein,
    meal,
    calories,
    proteinG,
    carbsG,
    fatG,
    yieldText,
    prep: null,
    cook: null,
    ingredients,
    instructions,
    macroNote: "Auto-extracted from an Instagram caption — double-check macros and steps before relying on them.",
    image,
    source: url || null,
  };

  recipes.push(recipe);
  fs.writeFileSync(RECIPES_PATH, JSON.stringify(recipes, null, 1) + "\n");

  setOutput("added", "true");
  setOutput("title", title);
  console.log("Added recipe:", id, "-", title);
}

main();
