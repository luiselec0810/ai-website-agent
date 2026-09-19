/**
 * Tests para el módulo de normalización.
 *
 * El plugin WordPress devuelve listas en 4+ formas diferentes. El normalizador
 * debe converger todas a la forma canónica `{ items, pagination }`.
 */

import { describe, it, expect } from 'vitest';
import { normalizeList, normalizeSingle } from '../../src/normalizers/index.js';

describe('normalizeList', () => {
  describe('caso array directo', () => {
    it('envuelve array en { items, pagination }', () => {
      const raw = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = normalizeList<{ id: number }>(raw);

      expect(result.items).toHaveLength(3);
      expect(result.items[0].id).toBe(1);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.per_page).toBe(3);
      expect(result.pagination.page).toBe(1);
    });

    it('respeta per_page_override cuando se pasa', () => {
      const raw = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = normalizeList<number>(raw, { per_page_override: 5 });

      expect(result.items).toHaveLength(10);
      expect(result.pagination.per_page).toBe(5);
      expect(result.pagination.total).toBe(10);
    });

    it('maneja array vacío', () => {
      const result = normalizeList<unknown>([]);
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('caso { data: [...], pagination }', () => {
    it('extrae items desde data y pagination desde siblings', () => {
      const raw = {
        success: true,
        data: [{ id: 'p1' }, { id: 'p2' }],
        pagination: { total: 47, per_page: 10, page: 2 },
      };
      const result = normalizeList<{ id: string }>(raw);

      expect(result.items).toHaveLength(2);
      expect(result.items[1].id).toBe('p2');
      expect(result.pagination.total).toBe(47);
      expect(result.pagination.per_page).toBe(10);
      expect(result.pagination.page).toBe(2);
    });

    it('usa defaults si pagination está ausente', () => {
      const raw = { data: [{ a: 1 }] };
      const result = normalizeList<{ a: number }>(raw);

      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
    });
  });

  describe('caso { items: [...], pagination }', () => {
    it('extrae items desde items', () => {
      const raw = {
        items: [{ x: 1 }],
        pagination: { total: 1, page: 1, per_page: 50 },
      };
      const result = normalizeList<{ x: number }>(raw);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].x).toBe(1);
      expect(result.pagination.total).toBe(1);
    });

    it('prioriza items sobre data si ambos existen', () => {
      // Edge case: si por error un plugin devuelve ambos, items gana.
      const raw = { items: [{ from: 'items' }], data: [{ from: 'data' }] };
      const result = normalizeList<{ from: string }>(raw);

      expect(result.items[0].from).toBe('items');
    });
  });

  describe('caso null/undefined', () => {
    it('devuelve lista vacía para null', () => {
      const result = normalizeList(null);
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('devuelve lista vacía para undefined', () => {
      const result = normalizeList(undefined);
      expect(result.items).toEqual([]);
    });

    it('respeta per_page_override en null', () => {
      const result = normalizeList(null, { per_page_override: 25 });
      expect(result.pagination.per_page).toBe(25);
    });
  });

  describe('caso forma desconocida', () => {
    it('devuelve lista vacía para objeto sin items ni data', () => {
      const result = normalizeList({ random: 'object' });
      expect(result.items).toEqual([]);
    });

    it('devuelve lista vacía para string', () => {
      const result = normalizeList('not a list');
      expect(result.items).toEqual([]);
    });

    it('devuelve lista vacía para número', () => {
      const result = normalizeList(42);
      expect(result.items).toEqual([]);
    });
  });

  describe('tipos', () => {
    it('preserva tipos genéricos', () => {
      interface MyItem {
        id: number;
        title: string;
      }
      const raw: MyItem[] = [{ id: 1, title: 'A' }, { id: 2, title: 'B' }];
      const result = normalizeList<MyItem>(raw);

      // TypeScript debe inferir correctamente; el test runtime es estructural.
      const first: MyItem = result.items[0];
      expect(first.id).toBe(1);
      expect(first.title).toBe('A');
    });
  });
});

describe('normalizeSingle', () => {
  it('retorna el objeto tal cual si es válido', () => {
    const raw = { id: 1, name: 'foo' };
    const result = normalizeSingle<{ id: number; name: string }>(raw);
    expect(result).toEqual({ id: 1, name: 'foo' });
  });

  it('retorna null para null/undefined', () => {
    expect(normalizeSingle(null)).toBeNull();
    expect(normalizeSingle(undefined)).toBeNull();
  });

  it('retorna null para primitivos', () => {
    expect(normalizeSingle('string')).toBeNull();
    expect(normalizeSingle(42)).toBeNull();
    expect(normalizeSingle(true)).toBeNull();
  });

  it('pasa arrays (no debería pero defensivo)', () => {
    const result = normalizeSingle<unknown[]>([{ a: 1 }]);
    expect(result).toEqual([{ a: 1 }]);
  });
});
