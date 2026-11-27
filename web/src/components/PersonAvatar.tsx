import { HStack, Text } from '@chakra-ui/react';
import { MemberAvatar, Tooltip } from '@team6083/ui';

/**
 * A person in a table: only their avatar, with their name on hover or focus. On a phone, where a table becomes
 * cards and there is room, the name is written next to the avatar.
 */
export function PersonAvatar({ name, tip = name }: { name: string; tip?: string }) {
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
