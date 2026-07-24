import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { Store } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useStores(warehouseId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.stores(warehouseId ?? ''), activeSource()],
    enabled: Boolean(warehouseId),
    queryFn: (): Promise<Store[]> => getRepositories().stores.listByWarehouse(warehouseId as string),
  });
}

export function useCreateStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { warehouseId: string; name: string }) =>
      getRepositories().stores.create(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.stores(vars.warehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
  });
}

export function useUpdateStorePosition(warehouseId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, x, y }: { storeId: string; x: number; y: number }) =>
      getRepositories().stores.updatePosition(storeId, x, y),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.stores(warehouseId ?? '') });
    },
  });
}
