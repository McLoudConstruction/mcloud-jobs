'use client';
import { MessagesIcon, ReceiptIcon, WorkOrderIcon, ChangeOrderIcon, InternalUpdatesIcon } from './icons';
import { isOpportunity } from '../lib/constants';

// A row of icon shortcuts, separate from the main text tab bar above it —
// jumps straight to a specific tab/section from wherever you currently
// are on the job page, rather than needing to first find the right tab
// in the row. Receipts/Work Orders/Change Orders match the same
// hide-until-Approved rule their actual tabs already follow, so this
// never links to something that isn't there yet.
export default function JobQuickAccessIcons({ job, onNavigate }) {
  const pastOpportunity = !isOpportunity(job);

  const items = [
    { key: 'messages', label: 'Messages', Icon: MessagesIcon, onClick: () => onNavigate('Updates', 'messages'), show: true },
    { key: 'receipts', label: 'Receipts', Icon: ReceiptIcon, onClick: () => onNavigate('Receipts'), show: pastOpportunity },
    { key: 'work-orders', label: 'Work Orders', Icon: WorkOrderIcon, onClick: () => onNavigate('Work Orders'), show: pastOpportunity },
    { key: 'change-orders', label: 'Change Orders', Icon: ChangeOrderIcon, onClick: () => onNavigate('Change Orders'), show: pastOpportunity },
    { key: 'internal-updates', label: 'Internal Updates', Icon: InternalUpdatesIcon, onClick: () => onNavigate('Internal Updates'), show: true },
  ].filter(i => i.show);

  if (items.length === 0) return null;

  return (
    <div className="job-quick-access no-print" role="navigation" aria-label="Quick access">
      {items.map(({ key, label, Icon, onClick }) => (
        <button key={key} type="button" className="job-quick-access-btn" onClick={onClick} title={label} aria-label={label}>
          <Icon width={18} height={18} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
