"use strict";

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
// Deliberately does NOT include a bare "bowl"/"smoothie" catch-all — those are container
// formats, not dish identities (a "bowl" could be rice, poke, smoothie, or anything else), so
// matching on the word alone let a fruit smoothie-bowl photo pass for "Buffalo Chicken Potato
// Bowls". The specific bowl types below (rice bowl, burrito bowl, etc.) are precise enough to
// keep; anything less specific falls through to the multi-keyword check in isRelevant().
const DISH_KEYWORDS = [
  "mac and cheese", "fried rice", "rice bowl", "burrito bowl", "power bowl", "buddha bowl",
  "stir fry", "spring rolls", "sheet pan", "overnight oats", "protein pancakes", "protein waffles",
  "egg muffins", "energy balls", "protein balls", "protein bars", "banana bread", "chicken wings",
  "loaded fries", "sweet potato", "shepherds pie", "cottage pie", "chow mein", "pad thai", "curry",
  "tacos", "taco", "burrito", "quesadilla", "wraps", "wrap", "salad", "soup", "stew", "chilli",
  "chili", "burgers", "burger", "pizza", "sandwich", "bagel", "omelette", "omelet", "pancakes",
  "waffles", "oats", "noodles", "pasta", "risotto", "paella", "casserole", "meatballs", "kebabs",
  "kebab", "skewers", "nachos", "enchiladas", "fajitas", "biryani", "shawarma", "gyro", "cake",
  "cookies", "brownies", "donuts", "muffins",
];

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

// Recipe titles and photo descriptions don't reliably agree on singular vs. plural (a title
// says "Chicken Fajita Rice", DISH_KEYWORDS only lists "fajitas") — cheaply cover both by also
// trying the phrase with its trailing "s" added or removed. Only applies to single-word phrases;
// multi-word phrases like "mac and cheese" don't pluralize this way.
function pluralVariants(phrase) {
  if (phrase.includes(" ")) return [phrase];
  if (phrase.endsWith("s") && phrase.length > 3) return [phrase, phrase.slice(0, -1)];
  return [phrase, phrase + "s"];
}

function findDishType(title) {
  const normalized = normalizeDishText(title);
  return DISH_KEYWORDS.find((phrase) => pluralVariants(phrase).some((v) => normalized.includes(v))) || null;
}

function containsPhrase(text, phrase) {
  const synonyms = DISH_SYNONYMS[phrase] || [phrase];
  const variants = synonyms.flatMap(pluralVariants);
  return variants.some((v) => new RegExp("\\b" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(text));
}

// Relevance requires the dish-defining term itself (e.g. "mac and cheese") in the photo's
// description — not just any keyword — since generic words alone let unrelated photos through.
// Titles with no recognized dish type fall back to requiring at least two significant keywords
// to show up (or the only one available, if there's just one) — a single generic word match
// (e.g. "bowls" alone matching a fruit smoothie bowl for "Buffalo Chicken Potato Bowls") isn't
// strong enough evidence on its own.
function isRelevant(photo, title, dishType, keywords) {
  const alt = normalizeDishText(photo.alt || "");
  if (!alt) return false;
  if (dishType) return containsPhrase(alt, dishType);
  if (keywords.length === 0) return false;
  const matchCount = keywords.filter((kw) => containsPhrase(alt, kw)).length;
  return matchCount >= Math.min(2, keywords.length);
}

module.exports = { normalizeDishText, extractKeywords, findDishType, isRelevant };
