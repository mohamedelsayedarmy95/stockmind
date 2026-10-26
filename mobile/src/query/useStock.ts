import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BalanceResponse } from '@/api/types';
import { getRepositories, activeSource } from '@/data/repository-provider';
import {
  MovementInput,
  TransferInput,
  StoreBalance,
  AvailabilitySnapshot,
} from '@/data/repositories';
import { httpStatusOf } from '@/domain/auth-flow';
import { writeRejectionOf } from '@/domain/idempotent-write';
import { onOwnWriteRejected, onOwnWriteSucceeded, useWarehouseEntry } from '@/sync/warehouse-sync';
import { isCachedStockVisible } from '@/domain/balance-truth';
import { queryKeys } from './queryClient';
import { useCurrentScopeKey } from '@/sync/account-scope';
import { BASE_URL } from '@/api/client';

/** Online: re-poll after the user's own write, and record a 409/422 so the stock screen can say Rejected. */
function reportOnlineWrite(warehouseIds: string[], error?: unknown) {
  if (activeSource() !== 'online') return;
  const rejection = error === undefined ? null : writeRejectionOf(httpStatusOf(error));
  for (const id of warehouseIds) {
    if (error === undefined) onOwnWriteSucceeded(id);
    else if (rejection) onOwnWriteRejected(id, rejection);
  }
}

/** On-hand vs reserved vs issuable — what a dispatch may actually consume. */
export function useAvailability(productId?: string, warehouseId?: string) {
  const scope = useCurrentScopeKey();
  const online = activeSource() === 'online';
  const entry = useWarehouseEntry(warehouseId, online);
  const query = useQuery({
    queryKey: [...queryKeys.availability(productId ?? '', warehouseId ?? ''), activeSource(), scope, BASE_URL],
    enabled: Boolean(productId && warehouseId),
    queryFn: (): Promise<AvailabilitySnapshot> =>
      getRepositories().stock.availability(productId as string, warehouseId as string),
  });
  const denied = online && productId && entry && !isCachedStockVisible(entry, productId);
  // TanStack retains old availability data after an error too; every stock figure must obey the same deny overlay.
  return { ...query, data: denied ? undefined : query.data };
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
  const scope = useCurrentScopeKey();
  return useQuery({
    queryKey: [...queryKeys.balance(productId ?? '', warehouseId ?? ''), activeSource(), scope, BASE_URL],
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
      reportOnlineWrite([vars.warehouseId]);
    },
    onError: (err, vars) => {
      reportOnlineWrite([vars.warehouseId], err);
      // A refusal usually means the figure on screen is stale (someone else moved stock first): refetch it.
      if (writeRejectionOf(httpStatusOf(err))) {
        qc.invalidateQueries({ queryKey: queryKeys.balance(vars.productId, vars.warehouseId) });
        qc.invalidateQueries({ queryKey: queryKeys.availability(vars.productId, vars.warehouseId) });
      }
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
      reportOnlineWrite([vars.fromWarehouseId, vars.toWarehouseId]);
    },
    onError: (err, vars) => reportOnlineWrite([vars.fromWarehouseId, vars.toWarehouseId], err),
  });
}
