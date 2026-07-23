import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Product } from '@/api/types';
import { queryKeys } from './queryClient';

export function useProducts() {
  return useQuery({
    queryKey: queryKeys.products,
    queryFn: async (): Promise<Product[]> => {
      const { data } = await api.get<Product[]>('/products');
      return data;
    },
  });
}

/** Client-side lookup by scanned barcode over the cached product list. */
export function useProductByBarcode(products: Product[] | undefined, barcode: string | null) {
  if (!products || !barcode) return undefined;
  return products.find((p) => p.barcode === barcode);
}
