import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listReminders, createReminder, completeReminder, Reminder } from '@/data/local/notes-reminders';

export function useReminders(productId: string | undefined) {
  return useQuery({
    queryKey: ['reminders', productId ?? ''],
    enabled: Boolean(productId),
    queryFn: (): Promise<Reminder[]> => listReminders(productId as string),
  });
}

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: string; title: string; body?: string | null; remindAt: Date }) =>
      createReminder(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['reminders', vars.productId] });
    },
  });
}

export function useCompleteReminder(productId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => completeReminder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders', productId ?? ''] });
    },
  });
}
