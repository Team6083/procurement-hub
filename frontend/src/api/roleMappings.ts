import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import type { CreateRoleMappingRequest, Page, PatchRoleMappingRequest, RoleMapping } from './types';
import { useGuardedMutation } from './useGuardedMutation';

export const roleMappingsKey = ['role-mappings'] as const;

export function useRoleMappings(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: roleMappingsKey,
    enabled,
    queryFn: async ({ signal }) => (await api.get<Page<RoleMapping>>('/admin/role-mappings', { signal })).items,
  });
}

// Rules carry no version and the endpoints take no If-Match; the list is refetched after every change.
export function useCreateRoleMapping() {
  const api = useApi();
  return useGuardedMutation<CreateRoleMappingRequest, RoleMapping>({
    mutationFn: (body) => api.post<RoleMapping>('/admin/role-mappings', body),
    invalidate: [roleMappingsKey],
  });
}

export function usePatchRoleMapping() {
  const api = useApi();
  return useGuardedMutation<{ id: string; patch: PatchRoleMappingRequest }, RoleMapping>({
    mutationFn: ({ id, patch }) => api.patch<RoleMapping>(`/admin/role-mappings/${id}`, patch),
    invalidate: [roleMappingsKey],
  });
}

export function useDeleteRoleMapping() {
  const api = useApi();
  return useGuardedMutation<string, void>({
    mutationFn: (id) => api.delete<void>(`/admin/role-mappings/${id}`),
    invalidate: [roleMappingsKey],
  });
}
