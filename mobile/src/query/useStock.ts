import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { BalanceResponse } from '@/api/types';
import { queryKeys } from './queryClient';

export function useBalance(productId?: string, warehouseId?: string) {
  return useQuery({
    queryKey: queryKeys.balance(productId ?? '', warehouseId ?? ''),
    enabled: Boolean(productId && warehouseId),
    queryFn: async (): Promise<BalanceResponse> => {
      const { data } = await api.get<BalanceResponse>(
        `/stock/balance/${productId}/${warehouseId}`,
      );
      return data;
    },
  });
}

export type MovementKind = 'inbound' | 'outbound';

interface MovementInput {
  kind: MovementKind;
  productId: string;
  warehouseId: string;
  quantity: string;
  notes?: string;
}

export function useStockMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, ...body }: MovementInput) => {
      const { data } = await api.post(`/stock/${kind}`, body);
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.balance(vars.productId, vars.warehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.movements(vars.productId) });
    },
  });
}
