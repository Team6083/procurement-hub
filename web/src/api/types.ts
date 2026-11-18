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
export type Fulfillment = components['schemas']['Fulfillment'];
export type VendorTask = components['schemas']['VendorTask'];
export type Vendor = components['schemas']['Vendor'];

export type ItemWithLines = components['schemas']['ItemWithLines'];
export type LinkedLine = components['schemas']['LinkedLine'];
export type VendorOrder = components['schemas']['VendorOrder'];
export type VendorOrderSummary = components['schemas']['VendorOrderSummary'];
export type VendorOrderLine = components['schemas']['VendorOrderLine'];
export type CostEntry = components['schemas']['CostEntry'];
export type CostEntryBody = components['schemas']['CostEntryRequest'];
export type CostAllocation = components['schemas']['CostAllocation'];
/** The `refund` object of a line closure or problem resolution. */
export type RefundBody = components['schemas']['RefundInput'];
export type OrderTotals = components['schemas']['OrderTotals'];
export type QueueGroup = components['schemas']['QueueGroup'];
export type QueueItem = components['schemas']['QueueItem'];
export type LineStatus = components['schemas']['LineStatus'];
export type OrderStatus = VendorOrder['status'];
export type ReceivingState = components['schemas']['ReceivingState'];
export type AccountingState = components['schemas']['AccountingState'];

export type Delivery = components['schemas']['Delivery'];
export type DeliverySummary = components['schemas']['DeliverySummary'];
export type DeliveryLine = components['schemas']['DeliveryLine'];
export type MatchView = components['schemas']['MatchView'];
export type MatchState = components['schemas']['MatchState'];
export type Candidate = components['schemas']['Candidate'];
export type Problem = components['schemas']['Problem'];
export type ProblemSummary = components['schemas']['ProblemSummary'];
export type ProblemAction = components['schemas']['ResolveProblemRequest']['action'];
export type DeliveryLineRequest = components['schemas']['DeliveryLineRequest'];
export type MatchRequest = components['schemas']['MatchRequest'];
