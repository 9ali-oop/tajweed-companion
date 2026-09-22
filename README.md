# Tajweed Companion

Short interactive drills accompanying Dr. Ayman Rushdi Swaid's 45-part video
commentary on **التجويد المصور**. One unit per episode: a few teaching cards,
then ten to thirteen questions, about four minutes.

**Live:** https://9ali-oop.github.io/tajweed-companion/

## What this is, and is not

A companion, not a substitute. The teaching is the Shaykh's; each unit links to
the episode it accompanies. Nothing here reproduces his book.

It also does not assess your recitation. Tajweed is oral, and no web page can
hear whether your ṭāʾ came from the right makhraj. Where a drill is physical,
it says plainly that you are the judge.

## Accuracy

Every unit was drafted from the lesson transcript, then checked by two
independent reviewers — one on tajweed correctness under حفص عن عاصم, one on
textual accuracy — before being published. Questions that could not be made
unambiguously correct were deleted rather than patched.

That pass was not decorative. Across the units it caught a false claim about
which letter sits deepest in the throat, a mis-keyed answer about which letter
is sākin in Sūrat ash-Sharḥ, an inverted scholarly attribution, and two
non-Qurʾānic words cited as Qurʾānic.

Qurʾānic quotations are verified against the Uthmani text at build time, on word
boundaries — a fragment that begins or ends mid-word is still a substring of its
verse, and reads as a real quotation while being a mangled one.

Verses of **المقدمة الجزرية** follow a 109-verse edition. Editions run 107, 108
or 109 verses, so verse numbers are edition-relative.

If you find an error, it is ours and not the Shaykh's.

## Progress

Progress is stored in your browser, per device. There are no accounts, nothing
is uploaded, and nothing about you leaves the page. Clearing site data clears
your progress.

## Files

| File | What |
|---|---|
| `index.html` | the page |
| `style.css` | all styling; light and dark |
| `app.js` | hub, drill engine, progress |
| `data.js` | `window.CATALOGUE` (all 45 episodes) and `window.UNITS` (the built units) |

No build step and no dependencies beyond Google Fonts — clone it and open
`index.html`, or serve the directory.

`data.js` is generated from per-unit source files kept outside this repo. To add
units, regenerate `data.js` and commit it.

## Licence

The drill questions and site code are MIT (see `LICENSE`). The Qurʾānic text and
المقدمة الجزرية are not ours to licence and are quoted as source material; the
lectures belong to their author.
