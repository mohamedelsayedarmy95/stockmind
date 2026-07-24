import { useQuery } from '@tanstack/react-query';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { DashboardStats } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useDashboardStats() {
  return useQuery({
    queryKey: [...queryKeys.dashboardStats, activeSource()],
    queryFn: (): Promise<DashboardStats> => getRepositories().stock.dashboardStats(),
  });
}
