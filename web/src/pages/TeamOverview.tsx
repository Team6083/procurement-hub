import { Card, DataList, List, Stack, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuPackage } from 'react-icons/lu';
import { useTeamCtx } from '../features/teams/TeamContext';

export function TeamOverview() {
  const { t } = useTranslation('teams');
  const { team, full } = useTeamCtx();
  const active = full?.subgroups.filter((g) => g.active) ?? [];
  return (
    <Stack gap="6">
      {team.description ? <Text whiteSpace="pre-wrap">{team.description}</Text> : <Text color="fg.muted">{t('team.noDescription')}</Text>}
      {full && (
        <Card.Root size="sm">
          <Card.Body>
            <DataList.Root orientation="horizontal" gap="3">
              <DataList.Item>
                <DataList.ItemLabel>{t('general.visibility')}</DataList.ItemLabel>
                <DataList.ItemValue>{t(`team.visibility.${full.visibility}`)}</DataList.ItemValue>
              </DataList.Item>
              <DataList.Item>
                <DataList.ItemLabel>{t('general.locale')}</DataList.ItemLabel>
                <DataList.ItemValue>{t(`common:language.${full.locale}`)}</DataList.ItemValue>
              </DataList.Item>
              <DataList.Item>
                <DataList.ItemLabel>{t('team.subgroups')}</DataList.ItemLabel>
                <DataList.ItemValue>
                  {active.length === 0 ? (
                    <Text color="fg.muted">{t('team.noSubgroups')}</Text>
                  ) : (
                    <List.Root ps="4">
                      {active.map((g) => <List.Item key={g.id}>{g.name}</List.Item>)}
                    </List.Root>
                  )}
                </DataList.ItemValue>
              </DataList.Item>
            </DataList.Root>
          </Card.Body>
        </Card.Root>
      )}
      <Stack gap="0">
        <SectionHeader title={t('common:pages.batches')} />
        <Card.Root size="sm">
          <Card.Body>
            <EmptyState icon={<LuPackage />} title={t('team.batchesPlaceholder')} />
          </Card.Body>
        </Card.Root>
      </Stack>
    </Stack>
  );
}
