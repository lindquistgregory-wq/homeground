# Free static hosting for refreshable data

The app refreshes some bundled data (for now, the parcel-endpoint registry) from static JSON, so new counties can be added without an app release.

**Default: GitHub Pages** at `https://lindquistgregory-wq.github.io/homeground/registry/parcel-endpoints.json`.
- Free because the repository is public.
- `.github/workflows/pages.yml` publishes `packages/data/registry/` whenever it changes on `main`.
- **One-time setup:** in Settings → Pages, set the Source to **GitHub Actions**.

Until the host is live, the app uses the bundled registry and silently ignores the failed refresh.
