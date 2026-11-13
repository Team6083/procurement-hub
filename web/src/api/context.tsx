import { createContext, useContext } from 'react';
import type { ApiClient } from './client';

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const c = useContext(ApiContext);
  if (!c) throw new Error('ApiContext missing');
  return c;
}
