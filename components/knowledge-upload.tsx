'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, FileText, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useKnowledgeUpload,
  type KnowledgeDocument,
} from '@/hooks/use-knowledge-upload';
import { Button } from './ui/button';
import { Card } from './ui/card';

interface KnowledgeUploadProps {
  onUploadComplete?: (document: KnowledgeDocument) => void;
  className?: string;
  compact?: boolean;
}

export function KnowledgeUpload({
  onUploadComplete,
  className,
  compact = false,
}: KnowledgeUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const { uploadDocument, isUploading, uploadProgress, error } =
    useKnowledgeUpload();

  const handleFiles = useCallback(
    async (files: FileList) => {
      if (files.length === 0) return;

      const file = files[0];

      // Client-side validation for file size (15MB limit)
      const maxSize = 15 * 1024 * 1024; // 15MB
      if (file.size > maxSize) {
        toast.error(`File "${file.name}" is too large`, {
          description: 'Knowledge documents must be smaller than 15MB',
        });
        return;
      }

      // Validate file type
      const supportedExtensions = [
        '.pdf',
        '.docx',
        '.txt',
        '.md',
        '.markdown',
        '.epub',
      ];
      const fileExtension = file.name
        .toLowerCase()
        .substring(file.name.lastIndexOf('.'));
      if (!supportedExtensions.includes(fileExtension)) {
        toast.error(`File type "${fileExtension}" is not supported`, {
          description: 'Please upload PDF, DOCX, TXT, Markdown, or EPUB files',
        });
        return;
      }

      // Show info for large files that will use blob storage
      const blobThreshold = 4.5 * 1024 * 1024; // 4.5MB
      if (file.size > blobThreshold) {
        console.log(
          `Uploading large file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`,
        );
      }

      const document = await uploadDocument(file, { saveToBlob: true });

      if (document && onUploadComplete) {
        onUploadComplete(document);
      }
    },
    [uploadDocument, onUploadComplete],
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles],
  );

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  if (compact) {
    return (
      <div className={cn('relative', className)}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.epub"
          onChange={handleFileSelect}
          className="hidden"
          disabled={isUploading}
        />

        <Button
          onClick={openFileDialog}
          disabled={isUploading}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {isUploading ? 'Uploading...' : 'Add Document'}
        </Button>

        {isUploading && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-background border rounded-md p-2 shadow-lg z-10">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Processing document... {uploadProgress}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2 mt-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-destructive/10 border border-destructive/20 rounded-md p-2 shadow-lg z-10">
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className={cn('relative', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown,.epub"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      <div
        role="button"
        tabIndex={0}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
          dragActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25',
          isUploading && 'pointer-events-none opacity-50',
        )}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={openFileDialog}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            openFileDialog();
          }
        }}
      >
        {isUploading ? (
          <div className="space-y-4">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
            <div>
              <p className="text-lg font-medium">Processing document...</p>
              <p className="text-sm text-muted-foreground">
                Extracting text and generating embeddings for AI search
              </p>
              <div className="w-full max-w-xs mx-auto bg-muted rounded-full h-2 mt-4">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {uploadProgress}% complete
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="rounded-full bg-primary/10 p-3">
                <FileText className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div>
              <p className="text-lg font-medium">Upload Knowledge Documents</p>
              <p className="text-sm text-muted-foreground">
                Drag and drop files here, or click to browse
              </p>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Supported formats: PDF, DOCX, TXT, Markdown, EPUB</p>
              <p>Maximum file size: 15MB</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

// Component for displaying upload status
export function KnowledgeUploadStatus({
  isUploading,
  progress,
  error,
  className,
}: {
  isUploading: boolean;
  progress: number;
  error?: string | null;
  className?: string;
}) {
  if (!isUploading && !error) return null;

  return (
    <Card className={cn('p-4', className)}>
      {isUploading && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div className="flex-1">
              <p className="font-medium">Processing document...</p>
              <p className="text-sm text-muted-foreground">
                Extracting text and generating embeddings
              </p>
            </div>
            <span className="text-sm font-medium">{progress}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <div>
            <p className="font-medium">Upload failed</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
