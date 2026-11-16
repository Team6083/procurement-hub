import { Button, CloseButton, Dialog, Portal, useBreakpointValue } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Size = 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** `sm` confirm or reason, `md` forms, `lg` multi-column forms or record lists, `xl` the embedded order view. */
  size?: Size;
  /** The dialog's sections: a `Dialog.Body`, then a `DialogFooter` with its actions. */
  children: ReactNode;
}

/**
 * Modal dialog. Content mounts on open and unmounts after closing, so local state inside it
 * starts fresh each time; the content renders its own `Dialog.Body` and `DialogFooter`, so a form's
 * state can drive its footer buttons. Forms take the whole screen on phones; a `sm` confirm stays a
 * centered card there. The size is resolved to one value per breakpoint so `full` never leaks
 * its height and zero margins into wider screens.
 */
export function AppDialog({ open, onClose, title, size = 'md', children }: Props) {
  const { t } = useTranslation();
  const confirm = size === 'sm';
  const resolved = useBreakpointValue<Size | 'full'>({ base: confirm ? 'sm' : 'full', md: size }) ?? size;
  const full = resolved === 'full';
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      size={resolved}
      placement={confirm ? 'center' : 'top'}
      lazyMount
      unmountOnExit
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner px={full ? undefined : '4'}>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            {children}
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label={t('actions.close')} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

/**
 * A dialog's actions: Cancel (outline, closes the dialog) first, then the given buttons, the one
 * solid main action last. Buttons are `size="sm"`; destructive ones `colorPalette="red"`.
 */
export function DialogFooter({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Dialog.Footer flexWrap="wrap">
      <Dialog.ActionTrigger asChild>
        <Button variant="outline" size="sm">{t('actions.cancel')}</Button>
      </Dialog.ActionTrigger>
      {children}
    </Dialog.Footer>
  );
}
