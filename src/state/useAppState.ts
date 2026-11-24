// 全局应用状态: 船型/配载/当前选择, 持久化在 IndexedDB
import { useCallback, useEffect, useState } from 'react';
import type { Ship, StowagePlan, VoyageReport } from '../types';
import { db } from '../db/indexeddb';
import { generateSeedData } from '../data/seed';
import { uid } from '../lib/id';

export interface AppState {
  ready: boolean;
  ships: Ship[];
  stowages: StowagePlan[];
  reports: VoyageReport[];
  currentShipId: string | null;
  currentStowageId: string | null;
}

let cached: AppState | null = null;

export function useAppState() {
  const [state, setState] = useState<AppState>(cached ?? {
    ready: false, ships: [], stowages: [], reports: [], currentShipId: null, currentStowageId: null,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      let ships = await db.allShips();
      let stowages = await db.allStowages();
      if (ships.length === 0) {
        const seed = generateSeedData();
        for (const s of seed.ships) await db.putShip(s);
        for (const p of seed.stowages) await db.putStowage(p);
        ships = seed.ships;
        stowages = seed.stowages;
      }
      const reports = await db.allReports();
      if (!alive) return;
      const next: AppState = {
        ready: true,
        ships,
        stowages,
        reports,
        currentShipId: ships[0]?.id ?? null,
        currentStowageId: stowages.find((p) => p.shipId === ships[0]?.id)?.id ?? null,
      };
      cached = next;
      setState(next);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const [ships, stowages, reports] = await Promise.all([db.allShips(), db.allStowages(), db.allReports()]);
    const next = { ...cached!, ready: true, ships, stowages, reports };
    cached = next;
    setState(next);
  }, []);

  const saveShip = useCallback(async (ship: Ship) => {
    const updated = { ...ship, updatedAt: Date.now() };
    await db.putShip(updated);
    await refresh();
  }, [refresh]);

  const deleteShip = useCallback(async (id: string) => {
    await db.deleteShip(id);
    await refresh();
  }, [refresh]);

  const saveStowage = useCallback(async (plan: StowagePlan) => {
    const updated = { ...plan, updatedAt: Date.now() };
    await db.putStowage(updated);
    await refresh();
  }, [refresh]);

  const deleteStowage = useCallback(async (id: string) => {
    await db.deleteStowage(id);
    await refresh();
  }, [refresh]);

  const saveReport = useCallback(async (report: VoyageReport) => {
    await db.putReport(report);
    await refresh();
  }, [refresh]);

  const deleteReport = useCallback(async (id: string) => {
    await db.deleteReport(id);
    await refresh();
  }, [refresh]);

  const selectShip = useCallback((id: string) => {
    const next = {
      ...cached!,
      currentShipId: id,
      currentStowageId: cached!.stowages.find((p) => p.shipId === id)?.id ?? null,
    };
    cached = next;
    setState(next);
  }, []);

  const selectStowage = useCallback((id: string | null) => {
    const next = { ...cached!, currentStowageId: id };
    cached = next;
    setState(next);
  }, []);

  const addShip = useCallback(async (draft: Omit<Ship, 'id' | 'createdAt' | 'updatedAt' | 'obstructions' | 'eyePositions'>) => {
    const now = Date.now();
    const ship: Ship = {
      ...draft,
      id: uid('ship'),
      obstructions: [],
      eyePositions: [{ id: 'eye-center', name: '指挥位', pos: { x: draft.bridgeX + 4, y: 0, z: draft.eyeHeight }, mullions: [] }],
      createdAt: now,
      updatedAt: now,
    };
    await db.putShip(ship);
    await refresh();
    return ship.id;
  }, [refresh]);

  return {
    state,
    refresh,
    saveShip,
    deleteShip,
    saveStowage,
    deleteStowage,
    saveReport,
    deleteReport,
    selectShip,
    selectStowage,
    addShip,
  };
}
