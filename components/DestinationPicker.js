'use client';
import { useState } from 'react';
import { ChevronUpIcon, FolderIcon, PlusIcon, CheckIcon } from './photoIcons';

const GROUPS = [
  { key: 'main', title: null },
  { key: 'named', title: 'Folders' },
  { key: 'earlier', title: 'Earlier days' },
];

// Bottom sheet listing folders with a "New folder" row. Used by the folder
// pill below and by Move to folder in the gallery.
//   options  [{ value, label, group }]   value  currently selected value (optional)
//   onPick(value)      onCreate(name) -> Promise
export function FolderSheet({ open, onClose, title = 'Save photos to', options, value, onPick, onCreate }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  function close() { setCreating(false); setName(''); onClose(); }

  async function submit(e) {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try { await onCreate(name); close(); } finally { setBusy(false); }
  }

  return (
    <div className="dest-backdrop" onClick={close} role="presentation">
      <div className="dest-sheet" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="dest-sheet-title">{title}</div>
        <div className="dest-sheet-list">
          {GROUPS.map(g => {
            const rows = options.filter(o => o.group === g.key);
            if (!rows.length) return null;
            return (
              <div key={g.key}>
                {g.title && <div className="dest-group-title">{g.title}</div>}
                {rows.map(o => (
                  <button key={o.value} type="button" className="dest-row" onClick={() => { onPick(o.value); close(); }}>
                    <FolderIcon size={18} />
                    <span className="dest-row-label">{o.label}</span>
                    {o.value === value && <CheckIcon size={18} />}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        {creating ? (
          <form className="dest-new" onSubmit={submit}>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Folder name"
              maxLength={60}
              enterKeyHint="done"
            />
            <button type="submit" className="dest-new-save" disabled={!name.trim() || busy}>Create</button>
          </form>
        ) : (
          <button type="button" className="dest-row dest-row-new" onClick={() => setCreating(true)}>
            <PlusIcon size={18} />
            <span className="dest-row-label">New folder</span>
          </button>
        )}
        <button type="button" className="dest-cancel" onClick={close}>Cancel</button>
      </div>
    </div>
  );
}

// Shows the folder new photos are going into and lets the person change it
// or start a new folder. `destination` comes from usePhotoDestination().
// variant "camera" is the dark pill on the camera screen; "light" is for
// regular pages.
export default function DestinationPicker({ destination, variant = 'light', disabled = false }) {
  const [open, setOpen] = useState(false);
  if (!destination) return null;
  const { options, value, setValue, addFolder } = destination;
  const current = options.find(o => o.value === value);
  const label = current ? current.label : value;

  return (
    <>
      <button
        type="button"
        className={`dest-pill dest-pill-${variant}`}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={`Photos are going into ${label}. Change folder.`}
      >
        <FolderIcon size={18} />
        <span className="dest-pill-label">{label}</span>
        <ChevronUpIcon size={16} />
      </button>
      <FolderSheet
        open={open}
        onClose={() => setOpen(false)}
        options={options}
        value={value}
        onPick={setValue}
        onCreate={addFolder}
      />
    </>
  );
}
