import { useSettingsStore } from '@/store/settings.store';
import { ONLINE_MODE_DEV_PREVIEW } from '@/lib/dev-flags';
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
 * user explicitly picked Online — which only the dev preview flag allows.
 */
export function getRepositories(): Repositories {
  return activeSource() === 'online' ? apiRepositories : localRepositories;
}

/** For query keys — so caches are scoped per data source. */
export function activeSource(): 'online' | 'offline' {
  return ONLINE_MODE_DEV_PREVIEW && useSettingsStore.getState().operationMode === 'online' ? 'online' : 'offline';
}
