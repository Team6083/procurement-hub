import { CloseButton, Dialog, Portal } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Modal dialog. Content mounts on open and unmounts after closing, so local state inside it
 * starts fresh each time. Full-screen on narrow viewports.
 */
export function AppDialog({ open, onClose, title, size = 'md', children, footer }: Props) {
  const { t } = useTranslation();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      size={{ base: 'full', md: size }}
      lazyMount
      unmountOnExit
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body pb={footer ? undefined : 6}>{children}</Dialog.Body>
            {footer && <Dialog.Footer>{footer}</Dialog.Footer>}
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" aria-label={t('actions.close')} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
