import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { AskResponse } from '@/api/types';
import { useSettingsStore } from '@/store/settings.store';

export function useAskAssistant() {
  const language = useSettingsStore((s) => s.language);
  return useMutation({
    mutationFn: async (prompt: string): Promise<string> => {
      const { data } = await api.post<AskResponse>('/ai/ask', { prompt, language });
      return data.answer;
    },
  });
}
