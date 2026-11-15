import { createContext, useContext } from 'react';
import type { AppConfig } from '../configSchema';

/** Optional features from config.json; every one is off unless turned on there. */
export interface Features {
  bulkReceive: boolean;
}

export const featuresFrom = (config: Pick<AppConfig, 'features'>): Features => ({
  bulkReceive: config.features?.bulkReceive === true,
});

export const FeaturesContext = createContext<Features>({ bulkReceive: false });

export function useFeatures(): Features {
  return useContext(FeaturesContext);
}
