import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { StorageUnit, NewStorageUnit } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useStorageUnits(storeId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.storageUnits(storeId ?? ''), activeSource()],
    enabled: Boolean(storeId),
    queryFn: (): Promise<StorageUnit[]> =>
      getRepositories().storageUnits.listByStore(storeId as string),
  });
}

export function useCreateStorageUnit(storeId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewStorageUnit) => getRepositories().storageUnits.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.storageUnits(storeId ?? '') });
      qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
  });
}

export function useRemoveStorageUnit(storeId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getRepositories().storageUnits.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.storageUnits(storeId ?? '') });
      qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
  });
}
