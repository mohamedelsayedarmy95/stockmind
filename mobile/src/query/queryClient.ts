import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 5-minute cache to reduce backend pressure (per acceptance criteria).
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const queryKeys = {
  products: ['products'] as const,
  product: (id: string) => ['products', id] as const,
  balance: (productId: string, warehouseId: string) =>
    ['balance', productId, warehouseId] as const,
  movements: (productId: string) => ['movements', productId] as const,
};
