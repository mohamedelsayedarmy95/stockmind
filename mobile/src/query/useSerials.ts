import { useQuery } from '@tanstack/react-query';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { Serial, SerialMovementEntry } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useSerials(productId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.serials(productId ?? ''), activeSource()],
    enabled: Boolean(productId),
    queryFn: (): Promise<Serial[]> => getRepositories().serials.listByProduct(productId as string),
  });
}

export function useSerialHistory(serialId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.serialHistory(serialId ?? ''), activeSource()],
    enabled: Boolean(serialId),
    queryFn: (): Promise<SerialMovementEntry[]> =>
      getRepositories().serials.history(serialId as string),
  });
}
