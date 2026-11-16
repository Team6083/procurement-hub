import { useParams } from 'react-router';
import { VendorOrderView } from '../features/orders/VendorOrderView';

export function VendorOrderPage() {
  const { id } = useParams();
  return <VendorOrderView id={id ?? ''} />;
}
