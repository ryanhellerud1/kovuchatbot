import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export interface KnowledgeDocument {
  id: string;
  title: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  fileUrl?: string;
  summary: string;
  firstPageContent: string;
}

interface UploadResponse {
  success: true;
  document: KnowledgeDocument;
}

interface UploadError {
  success: false;
  error: string;
  details?: string;
}

interface UseKnowledgeUploadReturn {
  uploadDocument: (file: File, options?: { saveToBlob?: boolean }) => Promise<KnowledgeDocument | null>;
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
}

export function useKnowledgeUpload(): UseKnowledgeUploadReturn {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadDocument = useCallback(async (
    file: File, 
    options: { saveToBlob?: boolean } = {}
  ): Promise<KnowledgeDocument | null> => {
    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      // Validate file type
      const supportedExtensions = ['.pdf', '.docx', '.txt', '.md', '.markdown'];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      
      if (!supportedExtensions.includes(fileExtension)) {
        throw new Error('Unsupported file type. Please upload PDF, DOCX, TXT, or Markdown files.');
      }

      // Validate file size (15MB limit for knowledge documents)
      const maxSize = 15 * 1024 * 1024; // 15MB
      if (file.size > maxSize) {
        throw new Error('File size must be less than 15MB for knowledge documents.');
      }

      setUploadProgress(10);

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      
      // Automatically use blob storage for files larger than 4.5MB
      const blobThreshold = 4.5 * 1024 * 1024; // 4.5MB
      const shouldUseBlob = options.saveToBlob || file.size > blobThreshold;
      
      if (shouldUseBlob) {
        formData.append('saveToBlob', 'true');
      }

      setUploadProgress(20);
      console.log('Starting fetch to /api/knowledge/upload');

      // Upload to knowledge endpoint
      const response = await fetch('/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      }).catch(fetchError => {
        console.error('Fetch network error:', fetchError);
        throw fetchError; // Re-throw to be caught by the main try-catch
      });

      console.log('Fetch response received. Updating progress to 80%');
      setUploadProgress(80);

      const data: UploadResponse | UploadError = await response.json();

      if (!response.ok || !data.success) {
        const errorData = data as UploadError;
        throw new Error(errorData.error || 'Upload failed');
      }

      setUploadProgress(100);

      const successData = data as UploadResponse;
      
      toast.success(`Document "${successData.document.title}" uploaded successfully!`, {
        description: `Processed ${successData.document.chunkCount} chunks for AI search.`,
      });

      return successData.document;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      toast.error('Upload failed', {
        description: errorMessage,
      });
      return null;
    } finally {
      console.log('Upload process finished. Resetting state.');
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, []);

  return {
    uploadDocument,
    isUploading,
    uploadProgress,
    error,
  };
}

// Hook for managing knowledge documents
export function useKnowledgeDocuments() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/knowledge/documents');
      
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }

      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch documents';
      setError(errorMessage);
      toast.error('Failed to load documents', {
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteDocument = useCallback(async (documentId: string) => {
    try {
      const response = await fetch(`/api/knowledge/documents?id=${documentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      const data = await response.json();
      
      // Remove from local state
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));
      
      toast.success('Document deleted successfully', {
        description: `"${data.deletedDocument?.title}" has been removed from your knowledge base.`,
      });

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete document';
      setError(errorMessage);
      toast.error('Failed to delete document', {
        description: errorMessage,
      });
      return false;
    }
  }, []);

  return {
    documents,
    isLoading,
    error,
    fetchDocuments,
    deleteDocument,
    refetch: fetchDocuments,
  };
}