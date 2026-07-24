import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BalanceResponse } from '@/api/types';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { MovementInput } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useBalance(productId?: string, warehouseId?: string) {
  return useQuery({
    queryKey: [...queryKeys.balance(productId ?? '', warehouseId ?? ''), activeSource()],
    enabled: Boolean(productId && warehouseId),
    queryFn: (): Promise<BalanceResponse> =>
      getRepositories().stock.balance(productId as string, warehouseId as string),
  });
}

export type { MovementKind } from '@/data/repositories';

export function useStockMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MovementInput) => getRepositories().stock.move(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.balance(vars.productId, vars.warehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.movements(vars.productId) });
    },
  });
}
