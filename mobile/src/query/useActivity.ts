import { useQuery } from '@tanstack/react-query';
import { ActivityEntry } from '@/api/types';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { queryKeys } from './queryClient';

export function useActivity() {
  return useQuery({
    queryKey: [...queryKeys.activity, activeSource()],
    queryFn: (): Promise<ActivityEntry[]> => getRepositories().activity.list(),
  });
}
