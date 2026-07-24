import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Product } from '@/api/types';
import { getRepositories, activeSource } from '@/data/repository-provider';
import { NewProduct } from '@/data/repositories';
import { queryKeys } from './queryClient';

export function useProducts() {
  return useQuery({
    queryKey: [...queryKeys.products, activeSource()],
    queryFn: (): Promise<Product[]> => getRepositories().products.list(),
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewProduct) => getRepositories().products.create(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products });
    },
  });
}

/** Client-side lookup by scanned barcode over the cached product list. */
export function useProductByBarcode(products: Product[] | undefined, barcode: string | null) {
  if (!products || !barcode) return undefined;
  return products.find((p) => p.barcode === barcode);
}
