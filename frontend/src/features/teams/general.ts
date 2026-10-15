import type { PatchTeamRequest, Team } from '../../api/types';
import { cleanPriorityLabels } from './priority';
import type { GeneralForm } from './schemas';

export function toForm(team: Team): GeneralForm {
  const p = team.priorityLabels ?? {};
  return {
    name: team.name,
    description: team.description,
    visibility: team.visibility,
    locale: team.locale,
    priority: { '1': p['1'] ?? '', '2': p['2'] ?? '', '3': p['3'] ?? '', '4': p['4'] ?? '', '5': p['5'] ?? '' },
  };
}

/** Builds a PATCH body containing only what changed. */
export function diffGeneral(team: Team, v: GeneralForm): PatchTeamRequest {
  const body: PatchTeamRequest = {};
  if (v.name.trim() !== team.name) body.name = v.name.trim();
  if (v.description !== team.description) body.description = v.description;
  if (v.visibility !== team.visibility) body.visibility = v.visibility;
  if (v.locale !== team.locale) body.locale = v.locale;
  const next = cleanPriorityLabels(v.priority);
  const prev = cleanPriorityLabels(toForm(team).priority);
  if (JSON.stringify(next) !== JSON.stringify(prev)) body.priorityLabels = next;
  return body;
}
