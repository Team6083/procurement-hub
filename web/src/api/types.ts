import type { components } from './schema';

type S = components['schemas'];
export type Me = S['Me'];
export type MyMembership = S['MyMembership'];
export type Team = S['Team'];
export type TeamSummary = S['TeamSummary'];
export type TeamMember = S['TeamMember'];
export type Subgroup = S['Subgroup'];
export type ReferenceRate = S['ReferenceRate'];
export type RoleMapping = S['RoleMapping'];
export type User = S['User'];
export type Role = S['Role'];
export type RoleOrNone = S['RoleOrNone'];
export type Locale = S['Locale'];
export type Visibility = S['Visibility'];
export type PatchTeamRequest = S['PatchTeamRequest'];
export type CreateTeamRequest = S['CreateTeamRequest'];
export type PatchMemberRequest = S['PatchMemberRequest'];
export type CreateRoleMappingRequest = S['CreateRoleMappingRequest'];
export type RoleMappingRequest = S['RoleMappingRequest'];

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** GET /teams/{id} returns the full Team to members/system admins and a summary to others. */
export function isFullTeam(t: Team | TeamSummary): t is Team {
  return 'version' in t;
}

export type Batch = components['schemas']['Batch'];
export type BatchStatus = components['schemas']['BatchStatus'];
export type BatchAction = components['schemas']['BatchAction'];
export type Item = components['schemas']['Item'];
export type ItemStatus = components['schemas']['ItemStatus'];
export type ItemRequest = components['schemas']['ItemRequest'];
export type AuditEvent = components['schemas']['AuditEvent'];
export type MyTasks = components['schemas']['MyTasks'];
export type PatchBatchRequest = components['schemas']['PatchBatchRequest'];
export type AssignmentsRequest = components['schemas']['AssignmentsRequest'];
export type TransitionRequest = components['schemas']['TransitionRequest'];
export type ReviewRequest = components['schemas']['ReviewRequest'];
export type ReviewResult = components['schemas']['ReviewResult'];
export type Order = components['schemas']['Order'];
export type OrderStatus = components['schemas']['OrderStatus'];
export type OrderDetail = components['schemas']['OrderDetail'];
export type CreateOrderRequest = components['schemas']['CreateOrderRequest'];
export type PatchOrderRequest = components['schemas']['PatchOrderRequest'];
export type AdjustmentRequest = components['schemas']['AdjustmentRequest'];
export type AdjustmentResult = components['schemas']['AdjustmentResult'];
export type SharedCost = components['schemas']['SharedCost'];
export type SharedCostRequest = components['schemas']['SharedCostRequest'];
export type SharedCostType = components['schemas']['SharedCostType'];
export type VendorTransactionView = components['schemas']['VendorTransactionView'];
export type CreateVendorTransactionRequest = components['schemas']['CreateVendorTransactionRequest'];
export type PatchVendorTransactionRequest = components['schemas']['PatchVendorTransactionRequest'];
