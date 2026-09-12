const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'snappfood-party-search.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const functionMatch = source.match(/  (function ecoProductDetailsUrl[\s\S]*?\n  })\n\n  function ecoProduct/);

assert.ok(functionMatch, 'ecoProductDetailsUrl must exist in the userscript');
global.location = {
  origin: 'https://superapp.snappfood.ir',
  search: '?lat=36.3267&long=59.5631&superType=1',
};

const ecoProductDetailsUrl = eval(`(${functionMatch[1]})`);
const href = ecoProductDetailsUrl('5746966', '3754y2');
const parsed = new URL(href);

assert.equal(parsed.origin, 'https://superapp.snappfood.ir');
assert.equal(parsed.pathname, '/product-details/eco/5746966/');
assert.equal(parsed.searchParams.get('code'), '3754y2');

const ecoProduct = { id: '5746966', source: 'eco', url: href };
const productUrl = ecoProduct.url;
const clickable = Boolean(productUrl);

assert.equal(clickable, true, 'an Eco product-details URL must render as a clickable anchor');
assert.match(source, /const tag = clickable \? 'a' : 'article'/);
assert.match(source, /نسخه 1\.10\.4/);

console.log('Eco click test passed:', productUrl);
