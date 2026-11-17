import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import { keys } from './keys';
import type { CreateRoleMappingRequest, Page, RoleMappingRequest, RoleMapping } from './types';
import { useGuardedMutation } from './useGuardedMutation';
import { ifMatchHeader } from './versioned';

export function useRoleMappings(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: keys.roleMappings,
    enabled,
    queryFn: async ({ signal }) => (await api.get<Page<RoleMapping>>('/admin/role-mappings', { signal })).items,
  });
}

// Rules are versioned: PUT/DELETE send If-Match from the rule's `version` (the list is refetched on success and on conflict).
export function useCreateRoleMapping() {
  const api = useApi();
  return useGuardedMutation<CreateRoleMappingRequest, RoleMapping>({
    mutationFn: (body) => api.post<RoleMapping>('/admin/role-mappings', body),
  });
}

export function usePutRoleMapping() {
  const api = useApi();
  return useGuardedMutation<{ rule: RoleMapping; body: RoleMappingRequest }, RoleMapping>({
    mutationFn: ({ rule, body }) => api.put<RoleMapping>(`/admin/role-mappings/${rule.id}`, body, { headers: ifMatchHeader(rule.version) }),
  });
}

export function useDeleteRoleMapping() {
  const api = useApi();
  return useGuardedMutation<RoleMapping, void>({
    mutationFn: (rule) => api.delete<void>(`/admin/role-mappings/${rule.id}`, { headers: ifMatchHeader(rule.version) }),
  });
}
