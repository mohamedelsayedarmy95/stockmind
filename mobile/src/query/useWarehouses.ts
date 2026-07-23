import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuthStore } from '@/store/auth.store';

interface Warehouse {
  id: string;
  name: string;
  isActive?: boolean;
}

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: async (): Promise<Warehouse[]> => {
      const { data } = await api.get<Warehouse[]>('/warehouses');
      return data;
    },
  });
}

/**
 * Ensures `defaultWarehouseId` is populated after a plain login (whose response,
 * unlike register, carries no warehouse). Picks the first active warehouse.
 */
export function useEnsureDefaultWarehouse() {
  const defaultWarehouseId = useAuthStore((s) => s.defaultWarehouseId);
  const { data } = useWarehouses();

  useEffect(() => {
    if (defaultWarehouseId || !data?.length) return;
    const first = data.find((w: Warehouse) => w.isActive !== false) ?? data[0];
    if (first) {
      useAuthStore.setState({ defaultWarehouseId: first.id });
    }
  }, [defaultWarehouseId, data]);

  return defaultWarehouseId;
}
