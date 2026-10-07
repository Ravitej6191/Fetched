# Fetched!

A fan-made, just-for-fun search tool for movies, series and anime. It looks titles up through the
[OMDB API](https://www.omdbapi.com/) and opens a third-party embed player in a new tab. Nothing is
hosted, stored or sold here. Everything shown belongs to its respective owners.

Plain HTML/CSS/JS: no build step, no dependencies. Installable as a PWA.

## Features
- Search with debounce, type filter (movies / series, applied by the API), year range, "Load more"
- Home screen: **Continue watching**, **Popular picks**, **Anime picks**
- Card actions: click a card (or its **›** arrow) for details, hover and press **▶** to play, bookmark to save
- Series: season / episode picker with episode names and ✓ for watched episodes
- After playing: **Not working? Try <next source>** and **Next episode ▸**
- Watchlist, history, recent searches, light/dark theme
- Export / import your lists as a JSON file (home screen footer)
- Offline-capable app shell (service worker), swipe-down bottom sheet on phones (play from the details sheet)

## Run it
Any static server works:
```bash
npx http-server . -p 5188 -c-1
```
Then open http://localhost:5188.

## Files
`index.html`, `styles.css`, `script.js` (the app), `sw.js` (offline cache), `manifest.json` + `Assets/` (PWA icons and fallback images).

## Streaming sources
`EMBED_SOURCES` at the top of `script.js` lists the embed hosts. They change domains often. If one stops
working, edit its URL template (`{id}` = IMDb id, `{season}`, `{episode}`) or add another. Order matters:
the first entry is the default, and your last working choice per title is remembered.

## Configuration notes
- **OMDB key**: `API_KEY` in `script.js` is a free-tier key (1,000 requests/day) and is visible to anyone
  who opens the app. Use your own key from omdbapi.com if you share this around.
- **Popular / Anime rows** use hand-picked IMDb ids (`POPULAR_IDS`, `ANIME_IDS`), cached for 24 hours.
  OMDB has no trending endpoint. A live "trending" row would need a TMDB API key.
- Bump `CACHE` in `sw.js` when you change shell files so installed copies refresh.
