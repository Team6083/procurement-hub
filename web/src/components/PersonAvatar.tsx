import { HStack, Text } from '@chakra-ui/react';
import { MemberAvatar, Tooltip } from '@team6083/ui';

/**
 * A person in a table: only their avatar, with their name on hover or focus. On a phone, where a table becomes
 * cards and there is room, the name is written next to the avatar.
 */
export function PersonAvatar({ name, tip = name, showName = false }: { name: string; tip?: string; showName?: boolean }) {
  // With room to spare (a wide page of people), the name is always written next to the avatar, which is then
  // decorative; `tip` (for example the e-mail address) goes on the name.
  if (showName) {
    return (
      <HStack gap="2">
        <span aria-hidden style={{ display: 'inline-flex' }}><MemberAvatar size="2xs" name={name} /></span>
        <Tooltip content={tip}><Text tabIndex={0}>{name}</Text></Tooltip>
      </HStack>
    );
  }
  return (
    <HStack gap="2">
      <Tooltip content={tip}>
        <span tabIndex={0} role="img" aria-label={tip} style={{ display: 'inline-flex' }}>
          <MemberAvatar size="2xs" name={name} />
        </span>
      </Tooltip>
      <Text hideFrom="md">{name}</Text>
    </HStack>
  );
}
