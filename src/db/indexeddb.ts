// IndexedDB 持久层 —— 船型库 / 配载 / 航次报告
import type { Ship, StowagePlan, VoyageReport } from '../types';

const DB_NAME = 'bvs-db';
const DB_VERSION = 6;
const STORES = {
  ships: 'ships',
  stowages: 'stowages',
  reports: 'reports',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // 版本升级: 清掉旧 schema 的全部数据, 由种子逻辑重建
      for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
      if (!db.objectStoreNames.contains(STORES.ships)) db.createObjectStore(STORES.ships, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.stowages)) db.createObjectStore(STORES.stowages, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.reports)) db.createObjectStore(STORES.reports, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  async allShips(): Promise<Ship[]> {
    return tx(STORES.ships, 'readonly', (s) => s.getAll() as IDBRequest<Ship[]>);
  },
  async getShip(id: string): Promise<Ship | undefined> {
    return tx(STORES.ships, 'readonly', (s) => s.get(id) as IDBRequest<Ship | undefined>);
  },
  async putShip(ship: Ship): Promise<void> {
    await tx(STORES.ships, 'readwrite', (s) => s.put(ship));
  },
  async deleteShip(id: string): Promise<void> {
    await tx(STORES.ships, 'readwrite', (s) => s.delete(id));
  },

  async allStowages(shipId?: string): Promise<StowagePlan[]> {
    const all = await tx(STORES.stowages, 'readonly', (s) => s.getAll() as IDBRequest<StowagePlan[]>);
    return shipId ? all.filter((p) => p.shipId === shipId) : all;
  },
  async getStowage(id: string): Promise<StowagePlan | undefined> {
    return tx(STORES.stowages, 'readonly', (s) => s.get(id) as IDBRequest<StowagePlan | undefined>);
  },
  async putStowage(plan: StowagePlan): Promise<void> {
    await tx(STORES.stowages, 'readwrite', (s) => s.put(plan));
  },
  async deleteStowage(id: string): Promise<void> {
    await tx(STORES.stowages, 'readwrite', (s) => s.delete(id));
  },

  async allReports(shipId?: string): Promise<VoyageReport[]> {
    const all = await tx(STORES.reports, 'readonly', (s) => s.getAll() as IDBRequest<VoyageReport[]>);
    return shipId ? all.filter((r) => r.shipId === shipId) : all;
  },
  async putReport(report: VoyageReport): Promise<void> {
    await tx(STORES.reports, 'readwrite', (s) => s.put(report));
  },
  async deleteReport(id: string): Promise<void> {
    await tx(STORES.reports, 'readwrite', (s) => s.delete(id));
  },
};
