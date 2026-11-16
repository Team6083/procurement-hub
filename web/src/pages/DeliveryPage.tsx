import { useParams } from 'react-router';
import { ReceivingGuard } from '../features/receiving/access';
import { DeliveryView } from '../features/receiving/DeliveryView';

export function DeliveryPage() {
  const { id } = useParams();
  return (
    <ReceivingGuard>
      <DeliveryView id={id ?? ''} />
    </ReceivingGuard>
  );
}
