import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import type { CreateRoleMappingRequest, Page, RoleMappingRequest, RoleMapping } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader } from './versioned';

export const roleMappingsKey = ['role-mappings'] as const;

export function useRoleMappings(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: roleMappingsKey,
    enabled,
    queryFn: async ({ signal }) => (await api.get<Page<RoleMapping>>('/admin/role-mappings', { signal })).items,
  });
}

// Rules are versioned: PUT/DELETE send If-Match from the rule's `version` (the list is refetched on success and on conflict).
export function useCreateRoleMapping() {
  const api = useApi();
  return useGuardedMutation<CreateRoleMappingRequest, RoleMapping>({
    mutationFn: (body) => api.post<RoleMapping>('/admin/role-mappings', body),
    invalidate: [roleMappingsKey],
  });
}

export function usePutRoleMapping() {
  const api = useApi();
  return useGuardedMutation<{ rule: RoleMapping; body: RoleMappingRequest }, RoleMapping>({
    mutationFn: ({ rule, body }) => api.put<RoleMapping>(`/admin/role-mappings/${rule.id}`, body, { headers: ifMatchHeader(rule.version) }),
    invalidate: [roleMappingsKey],
  });
}

export function useDeleteRoleMapping() {
  const api = useApi();
  return useGuardedMutation<RoleMapping, void>({
    mutationFn: (rule) => api.delete<void>(`/admin/role-mappings/${rule.id}`, { headers: ifMatchHeader(rule.version) }),
    invalidate: [roleMappingsKey],
  });
}
