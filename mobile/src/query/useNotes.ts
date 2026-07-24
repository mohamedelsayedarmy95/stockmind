import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listNotes, createNote, Note } from '@/data/local/notes-reminders';

export function useNotes(productId: string | undefined) {
  return useQuery({
    queryKey: ['notes', productId ?? ''],
    enabled: Boolean(productId),
    queryFn: (): Promise<Note[]> => listNotes(productId as string),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, body }: { productId: string; body: string }) => createNote(productId, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['notes', vars.productId] });
    },
  });
}
