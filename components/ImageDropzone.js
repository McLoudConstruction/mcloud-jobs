'use client';
import { useState, useRef, useEffect } from 'react';

// Small drag-and-drop image field. Uncontrolled-ish: calls onFileSelected
// with the File (or null on clear) and manages its own preview locally.
export default function ImageDropzone({ file, onFileSelected, label = 'Photo' }) {
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFiles(fileList) {
    const picked = fileList && fileList[0];
    if (picked && picked.type.startsWith('image/')) onFileSelected(picked);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div>
      {label && <label>{label}</label>}
      <div
        className={`image-dropzone ${dragOver ? 'is-dragover' : ''} ${previewUrl ? 'has-preview' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
        {previewUrl ? (
          <>
            <img src={previewUrl} alt="Selected preview" className="image-dropzone-preview" />
            <button
              type="button"
              className="image-dropzone-clear"
              onClick={e => { e.stopPropagation(); onFileSelected(null); if (inputRef.current) inputRef.current.value = ''; }}
              aria-label="Remove photo"
            >
              ×
            </button>
          </>
        ) : (
          <div className="image-dropzone-empty">
            <span className="image-dropzone-icon">⤓</span>
            <span>Drag &amp; drop a photo here, or click to browse</span>
          </div>
        )}
      </div>
    </div>
  );
}
