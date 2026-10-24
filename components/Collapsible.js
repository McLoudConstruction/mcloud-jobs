'use client';
import { useState } from 'react';

// A titled section that opens and closes. Used for the lesser groups in the contact edit form
// (Address, Billing, Record settings) so the form starts short. The body is only on the page while
// open; the values live in the parent's form state, so closing a group loses nothing.
export default function Collapsible({ title, hint, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`cf-group${open ? ' open' : ''}`}>
      <button type="button" className="cf-group-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="cf-group-chevron" aria-hidden="true" />
        <span>{title}</span>
        {hint && <span className="cf-group-hint">{hint}</span>}
      </button>
      {open && <div className="cf-group-body">{children}</div>}
    </div>
  );
}
