import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { Reservation } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useReservations(productId: string | undefined, warehouseId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.reservations(productId ?? '', warehouseId ?? ''), activeSource()],
    enabled: Boolean(productId && warehouseId),
    queryFn: (): Promise<Reservation[]> =>
      getRepositories().reservations.listByProduct(productId as string, warehouseId as string),
  });
}

/** Reservations change what's issuable, so availability is invalidated too. */
function useReservationMutation(
  productId: string | undefined,
  warehouseId: string | undefined,
  run: (id: string) => Promise<void>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.reservations(productId ?? '', warehouseId ?? '') });
      qc.invalidateQueries({ queryKey: queryKeys.availability(productId ?? '', warehouseId ?? '') });
      qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
  });
}

export function useCreateReservation(productId: string | undefined, warehouseId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { quantity: number; reference?: string | null }) =>
      getRepositories().reservations.create({
        productId: productId as string,
        warehouseId: warehouseId as string,
        quantity: input.quantity,
        reference: input.reference ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.reservations(productId ?? '', warehouseId ?? '') });
      qc.invalidateQueries({ queryKey: queryKeys.availability(productId ?? '', warehouseId ?? '') });
      qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
  });
}

export function useReleaseReservation(productId: string | undefined, warehouseId: string | undefined) {
  return useReservationMutation(productId, warehouseId, (id) =>
    getRepositories().reservations.release(id),
  );
}

export function useFulfillReservation(productId: string | undefined, warehouseId: string | undefined) {
  return useReservationMutation(productId, warehouseId, (id) =>
    getRepositories().reservations.fulfill(id),
  );
}
