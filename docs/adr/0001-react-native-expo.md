# ADR 0001: React Native (Expo) with a pure-TypeScript core

**Status:** accepted (2026-09-28)

## Context
Greenfield iOS + Android app, US-first, with zero running costs. It needs heavy GIS parsing, on-device analysis, and native modules for CloudKit/Drive sync, BLE (Phase 4), and on-device LLMs (Phase 5).

## Decision
- React Native via Expo (custom dev client, SDK 55, New Architecture), with expo-router.
- The domain logic lives in dependency-free TypeScript packages (`packages/core`, `packages/providers`) that are unit-tested in Node and can later run in a web build or a worker.
- Native capabilities are Expo Modules in `modules/` (Swift and Kotlin).
- MapLibre (`@maplibre/maplibre-react-native` v11) with keyless OpenFreeMap and USGS tiles.

## Consequences
- Hermes may be too slow for raster math, so Phase 2 opens with a performance spike. If the < 500 ms shade target is missed, only the hot loop moves to native code (JSI/C++ or Swift/Kotlin).
- Expo Go can't run the app because of its native modules. Use a dev build (`expo run:ios` / `expo run:android`).
