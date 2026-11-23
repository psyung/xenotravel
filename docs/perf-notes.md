# F-5 loading baseline

Measured the current working tree with Node's `zlib`. The compressed columns estimate response body transfer sizes in bytes. Actual Vercel transfers depend on content encoding, cache state, and HTTP overhead.

| Asset | Uncompressed | gzip (level 6) | Brotli (quality 5) |
| --- | ---: | ---: | ---: |
| `public/app.js` | 299,623 | 93,726 | 83,686 |
| `public/styles.css` | 159,699 | 33,919 | 32,429 |
| `public/lib/messages.js` | 163,757 | 59,951 | 52,564 |
| **Total** | **623,079** | **187,596** | **168,679** |

`public/lib/*.js` contains 32 modules, including `messages.js`. This is a file count. The requests made on first load depend on the import graph and cache.

Measure a cold first load with Slow 3G throttling and the service worker disabled. Capture transferred bytes, the module request waterfall, and the time until the itinerary is usable. If translation bytes are a bottleneck, try loading only the active language. If the waterfall dominates, profile a small bundle before changing the build.
