import { useState, ChangeEvent } from 'react';
import { Upload, FileText, X, AlertCircle } from 'lucide-react';
import { isAllowedLogFile, MAX_UPLOAD_BYTES, formatFileSize, ALLOWED_LOG_EXTENSIONS } from '../lib/utils';

interface UploadZoneProps {
  /** Currently pasted log text (controlled by parent). */
  text: string;
  /** Currently selected file (controlled by parent). */
  file: File | null;
  onTextChange: (text: string) => void;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

export default function UploadZone({
  text,
  file,
  onTextChange,
  onFileChange,
  disabled = false,
}: UploadZoneProps) {
  const [isDragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const validateFile = (f: File): string | null => {
    if (!isAllowedLogFile(f.name)) {
      return `Unsupported file type "${f.name.split('.').pop() ?? 'unknown'}". Allowed: ${ALLOWED_LOG_EXTENSIONS.join(', ')}.`;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      return `File is too large (${formatFileSize(f.size)}). Maximum is ${formatFileSize(MAX_UPLOAD_BYTES)}.`;
    }
    return null;
  };

  const handleFileSelection = (f: File | null) => {
    if (!f) {
      onFileChange(null);
      setError(null);
      return;
    }
    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      onFileChange(null);
      return;
    }
    setError(null);
    onFileChange(f);
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onTextChange(e.target.value);
    if (e.target.value.trim().length > 0 && file) {
      onFileChange(null);
    }
    setError(null);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    handleFileSelection(f);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    handleFileSelection(e.dataTransfer.files[0] ?? null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };

  const removeFile = () => {
    onFileChange(null);
    setError(null);
  };

  return (
    <div
      className={`
        relative rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-200
        ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400'}
        ${disabled ? 'opacity-60 pointer-events-none' : ''}
      `}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {isDragActive && !disabled && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/20 backdrop-blur-sm">
          <span className="text-sm font-medium text-gray-900">Drop file here</span>
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <Upload className="w-10 h-10 text-gray-400" aria-hidden="true" />
        <p className="text-sm font-medium text-gray-900">CI failure log</p>
        <p className="text-xs text-gray-500">
          Drag &amp; drop or click to browse &mdash; {ALLOWED_LOG_EXTENSIONS.join(', ')}
        </p>
      </div>

      <input
        type="file"
        accept={ALLOWED_LOG_EXTENSIONS.join(',')}
        className="sr-only"
        onChange={handleFileChange}
        disabled={disabled}
        aria-label="Select a CI log file (.log or .txt)"
      />

      {/* Paste interface */}
      <div className="mt-6 w-full">
        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
          Or paste log text
        </label>
        <textarea
          className="w-full h-48 rounded-lg border border-gray-300 p-4 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
          placeholder="Paste your CI failure log here..."
          value={text}
          onChange={handleTextChange}
          disabled={disabled}
          aria-label="Paste CI failure log text"
        />
        <p className="mt-1 text-xs text-gray-500">
          Paste log text directly, or upload a {ALLOWED_LOG_EXTENSIONS.join(' or ')} file.
        </p>
      </div>

      {file && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
          <FileText className="w-4 h-4" aria-hidden="true" />
          <span className="font-medium">{file.name}</span>
          <span className="text-blue-600">({formatFileSize(file.size)})</span>
          <button
            onClick={removeFile}
            className="ml-auto rounded hover:bg-blue-200 text-blue-600 p-1 focus:outline-none"
            aria-label="Remove file"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          <span>{error}</span>
          <button
            onClick={clearError}
            className="ml-auto rounded hover:bg-red-100 text-red-500 p-1 focus:outline-none"
            aria-label="Dismiss error"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
