import { useSettingsStore } from '@/store/settings.store';
import { Repositories } from './repositories';
import { localRepositories } from './local/local-repositories';
import { apiRepositories } from './api/api-repositories';

/**
 * Single seam that resolves which data source is active. Everything above the
 * data layer calls getRepositories() and never imports a concrete source, so
 * flipping Offline↔Online (or adding a sync-aware source later) is a one-line
 * change here.
 *
 * Default is offline: the local encrypted DB is the source of truth unless the
 * user explicitly picked Online.
 */
export function getRepositories(): Repositories {
  const mode = useSettingsStore.getState().operationMode;
  return mode === 'online' ? apiRepositories : localRepositories;
}

/** For query keys — so caches are scoped per data source. */
export function activeSource(): 'online' | 'offline' {
  return useSettingsStore.getState().operationMode === 'online' ? 'online' : 'offline';
}
