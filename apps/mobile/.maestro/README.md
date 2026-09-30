# End-to-end flows (Maestro)

Maestro's CLI is free and Apache-2.0 (Maestro Cloud is paid and not used). Install it locally (Java 17+):

```sh
curl -fsSL "https://get.maestro.mobile.dev" | bash
export MAESTRO_CLI_NO_ANALYTICS=true   # the CLI collects usage analytics otherwise
```

Build a release app on a simulator or emulator, then run the flows:

```sh
npx expo run:ios --configuration Release        # or: npx expo run:android --variant release
maestro test apps/mobile/.maestro/
```

**Status: written but not yet run.** No device or simulator was available when these were written (Phase 6), so
labels, waits and tap positions may need adjusting on the first run. Debug builds show Google's test ads; the flows
only check that ads never appear on the design canvas, in the planner chat or on the paywall.

| Flow | Covers (§11) |
|---|---|
| `onboarding-to-schedule.yaml` | Find a property → draw a boundary → Site Profile → design (place a bed) → planting calendar |
| `paywall.yaml` | Paywall opens from a locked layer, annual plan preselected, disclosure and Restore present, no ad on the paywall |
| `offline.yaml` | Android only: offline pack keeps imagery and the Site Profile available in airplane mode (Pro dev tier) |
