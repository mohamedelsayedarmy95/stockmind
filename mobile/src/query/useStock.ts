import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BalanceResponse } from '@/api/types';
import { getRepositories, activeSource } from '@/data/repository-provider';
import {
  MovementInput,
  TransferInput,
  StoreBalance,
  AvailabilitySnapshot,
} from '@/data/repositories';
import { queryKeys } from './queryClient';

/** On-hand vs reserved vs issuable — what a dispatch may actually consume. */
export function useAvailability(productId?: string, warehouseId?: string) {
  return useQuery({
    queryKey: [...queryKeys.availability(productId ?? '', warehouseId ?? ''), activeSource()],
    enabled: Boolean(productId && warehouseId),
    queryFn: (): Promise<AvailabilitySnapshot> =>
      getRepositories().stock.availability(productId as string, warehouseId as string),
  });
}

export function useStoreBreakdown(productId?: string, warehouseId?: string) {
  return useQuery({
    queryKey: [...queryKeys.storeBreakdown(productId ?? '', warehouseId ?? ''), activeSource()],
    enabled: Boolean(productId && warehouseId),
    queryFn: (): Promise<StoreBalance[]> =>
      getRepositories().stock.storeBreakdown(productId as string, warehouseId as string),
  });
}

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
      qc.invalidateQueries({ queryKey: queryKeys.storeBreakdown(vars.productId, vars.warehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.availability(vars.productId, vars.warehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.batches(vars.productId, vars.warehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.serials(vars.productId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardStats });
      qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
  });
}

export function useStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransferInput) => getRepositories().stock.transfer(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.balance(vars.productId, vars.fromWarehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.balance(vars.productId, vars.toWarehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.movements(vars.productId) });
      qc.invalidateQueries({ queryKey: queryKeys.storeBreakdown(vars.productId, vars.fromWarehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.storeBreakdown(vars.productId, vars.toWarehouseId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboardStats });
      qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
  });
}
