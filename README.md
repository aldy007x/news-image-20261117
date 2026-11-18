# The World on Tuesday 17 November 2026

[![make.fun · news-image-20261117](https://make.fun/badge/news-image-20261117.svg)](https://make.fun/bounty/news-image-20261117?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261117)

One image that sums up the world's news of Tuesday 17 November 2026, drawn entirely by a
program: Ukraine brings down a span of the Crimea bridge, tankers hit mines in the Strait of
Hormuz (Iran says), Trump lands in Manila for the ASEAN summit, the Knesset ousts a Netanyahu
ally as speaker, and 128 nations open "killer robot" talks in Geneva — plus a ticker with
Nvidia's first earnings since Jensen Huang's exit, Japan's jet scramble, COP31 in Antalya and
US measles at a 1991 high.

`main.ts` is a self-contained Node program (standard library only): a small software
rasteriser, a hand-built stroke font, flat-colour scenes for each story, and a PNG encoder.
It runs with no network and writes the same bytes every run.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024×1024 PNG).
