import { useQuery } from '@tanstack/react-query';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { Batch } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useBatches(productId: string | undefined, warehouseId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.batches(productId ?? '', warehouseId ?? ''), activeSource()],
    enabled: Boolean(productId && warehouseId),
    queryFn: (): Promise<Batch[]> =>
      getRepositories().batches.listByProduct(productId as string, warehouseId as string),
  });
}
