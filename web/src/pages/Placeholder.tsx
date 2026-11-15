import { Card } from '@chakra-ui/react';
import { EmptyState, PageHeader } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuConstruction } from 'react-icons/lu';

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <Card.Root size="sm">
        <Card.Body>
          <EmptyState icon={<LuConstruction />} title={t('placeholder.title')} description={t('placeholder.body')} />
        </Card.Body>
      </Card.Root>
    </>
  );
}
