/** i18n key (in the `batches` namespace) for an audit action such as "batch.open". */
export function auditActionKey(action: string): string {
  return `timeline.actions.${action.replace(/\./g, '_')}`;
}

export const isSystemActor = (actor: string) => actor.startsWith('system:');

/** The backend emits a zero ObjectID instead of omitting unset ids. */
export const isZeroId = (id: string | undefined) => !id || /^0+$/.test(id);
