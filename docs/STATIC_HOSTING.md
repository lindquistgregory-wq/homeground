# Free static hosting for refreshable data

The app refreshes some bundled data (for now, the parcel-endpoint registry) from static JSON, so new counties can be added without an app release.

**Default: GitHub Pages** at `https://lindquistgregory-wq.github.io/homeground/registry/parcel-endpoints.json`.
- Free for **public** repositories. Pages on a **private** repo needs a paid GitHub plan. If this repo stays private, use Cloudflare Pages (free plan) instead and update `REMOTE_REGISTRY_URL` in `packages/data/src/index.ts` and the host list in `packages/data/src/sources.ts`.
- To enable it, go to Settings → Pages → Source: GitHub Actions, then add a workflow that publishes `packages/data/registry/`. The workflow isn't included yet so nothing publishes by accident.

Until the host is live, the app uses the bundled registry and silently ignores the failed refresh.
