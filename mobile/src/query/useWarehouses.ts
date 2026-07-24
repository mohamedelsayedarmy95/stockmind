import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { Warehouse } from '@/data/repositories';
import { useAuthStore } from '@/store/auth.store';

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses', activeSource()],
    queryFn: (): Promise<Warehouse[]> => getRepositories().warehouses.list(),
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => getRepositories().warehouses.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
    },
  });
}

/**
 * Ensures `defaultWarehouseId` is populated. Offline accounts start with no
 * warehouse, so this also creates a "Main Warehouse" on first run.
 */
export function useEnsureDefaultWarehouse() {
  const defaultWarehouseId = useAuthStore((s) => s.defaultWarehouseId);

  useEffect(() => {
    if (defaultWarehouseId) return;
    let cancelled = false;
    (async () => {
      const w = await getRepositories().warehouses.ensureDefault();
      if (!cancelled && w) {
        useAuthStore.setState({ defaultWarehouseId: w.id });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [defaultWarehouseId]);

  return defaultWarehouseId;
}
