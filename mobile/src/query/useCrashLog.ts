import { useQuery } from '@tanstack/react-query';
import { listCrashes, CrashEntry } from '@/lib/crash-reporting';

export function useCrashLog() {
  return useQuery({
    queryKey: ['crash-log'],
    queryFn: (): Promise<CrashEntry[]> => listCrashes(),
  });
}
