import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { uploadFileToBlob, processKnowledgeDocumentFromBlob, shouldUseDirectBlobUpload } from '@/lib/blob-upload-client';

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
        throw new Error(`File size must be less than 15MB for knowledge documents. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
      }

      setUploadProgress(5);

      // For files larger than 4.5MB, we must use blob upload
      // For smaller files, try traditional upload first
      const shouldTryBlob = shouldUseDirectBlobUpload(file.size) || options.saveToBlob;
      
      if (shouldTryBlob) {
        console.log(`File is too large for traditional upload (${(file.size / 1024 / 1024).toFixed(1)}MB), must use blob upload`);
        
        try {
          // Get user ID for proper folder structure
          const userResponse = await fetch('/api/user');
          if (!userResponse.ok) {
            throw new Error('Failed to get user information');
          }
          const userData = await userResponse.json();
          
          // Generate unique filename for the user's knowledge folder
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 8);
          const extension = file.name.substring(file.name.lastIndexOf('.'));
          const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
          const uniqueFilename = `${timestamp}_${randomSuffix}_${nameWithoutExt}${extension}`;
          const pathname = `knowledge/${userData.userId}/${uniqueFilename}`;
          
          // Upload directly to blob storage
          const blobResult = await uploadFileToBlob(file, {
            pathname,
            onProgress: (progress) => {
              // Map blob upload progress to 5-70%
              setUploadProgress(5 + (progress * 0.65));
            }
          });
          
          setUploadProgress(70);
          console.log('File uploaded to blob storage, now processing...');
          
          // Process the document from blob storage
          const processResult = await processKnowledgeDocumentFromBlob(
            blobResult.url,
            blobResult.filename
          );
          
          setUploadProgress(100);
          
          if (!processResult.success) {
            throw new Error(processResult.error || 'Failed to process document');
          }
          
          toast.success(`Document "${processResult.document.title}" uploaded successfully!`, {
            description: `Processed ${processResult.document.chunkCount} chunks for AI search.`,
          });
          
          // Notify all components to refresh their document list
          window.dispatchEvent(new CustomEvent(KNOWLEDGE_DOCS_EVENTS.REFRESH));

          return processResult.document;
        } catch (blobError) {
          console.error('Client-side blob upload failed:', blobError);
          
          // Provide a helpful error message based on the error
          const errorMessage = blobError instanceof Error ? blobError.message : 'Unknown error';
          
          if (errorMessage.includes('too large') || errorMessage.includes('size')) {
            throw new Error(`File too large for upload. Maximum size is 15MB for knowledge documents. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
          } else if (errorMessage.includes('type') || errorMessage.includes('unsupported')) {
            throw new Error(`Unsupported file type. Please upload PDF, DOCX, TXT, or Markdown files.`);
          } else {
            throw new Error(`Upload failed: ${errorMessage}`);
          }
        }
      }
      
      // For smaller files, use traditional upload
      console.log(`Using traditional upload for smaller file (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      setUploadProgress(10);

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('saveToBlob', 'false');

      setUploadProgress(20);

      // Upload to knowledge endpoint
      const response = await fetch('/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      });

      // Handle 413 (Request Entity Too Large) specifically
      if (response.status === 413) {
        console.error('Traditional upload failed with 413 error');
        throw new Error(`File too large for traditional upload. Please try again with a smaller file or contact support if this issue persists.`);
      }

      setUploadProgress(80);

      // Check if response is actually JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('Non-JSON response received:', responseText);
        throw new Error(`Server returned non-JSON response: ${response.status} ${response.statusText}`);
      }

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
      
      // Notify all components to refresh their document list
      window.dispatchEvent(new CustomEvent(KNOWLEDGE_DOCS_EVENTS.REFRESH));

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

// Global event system for knowledge documents synchronization
const KNOWLEDGE_DOCS_EVENTS = {
  REFRESH: 'knowledge-docs-refresh',
  DELETED: 'knowledge-docs-deleted',
  UPLOADED: 'knowledge-docs-uploaded',
} as const;

// Helper function to trigger global refresh
export function triggerKnowledgeDocsRefresh() {
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_DOCS_EVENTS.REFRESH));
}

// Hook for managing knowledge documents
export function useKnowledgeDocuments() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setError(null);

    try {
      // Add cache busting parameter to ensure fresh data
      const url = forceRefresh 
        ? `/api/knowledge/documents?_t=${Date.now()}`
        : '/api/knowledge/documents';
        
      const response = await fetch(url, {
        // Disable caching for this request
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      
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
      
      // Notify all other components about the deletion
      window.dispatchEvent(
        new CustomEvent(KNOWLEDGE_DOCS_EVENTS.DELETED, { 
          detail: { id: documentId } 
        })
      );
      
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

  // Listen for global refresh events
  useEffect(() => {
    const handleRefresh = () => {
      console.log('[KnowledgeDocuments] Received global refresh event');
      fetchDocuments(true);
    };
    
    const handleDocDeleted = (event: CustomEvent<{id: string}>) => {
      console.log(`[KnowledgeDocuments] Document deleted event: ${event.detail.id}`);
      // Update local state without refetching
      setDocuments(prev => prev.filter(doc => doc.id !== event.detail.id));
    };
    
    // Add event listeners
    window.addEventListener(KNOWLEDGE_DOCS_EVENTS.REFRESH, handleRefresh);
    window.addEventListener(KNOWLEDGE_DOCS_EVENTS.DELETED, handleDocDeleted as EventListener);
    
    // Cleanup
    return () => {
      window.removeEventListener(KNOWLEDGE_DOCS_EVENTS.REFRESH, handleRefresh);
      window.removeEventListener(KNOWLEDGE_DOCS_EVENTS.DELETED, handleDocDeleted as EventListener);
    };
  }, [fetchDocuments]);

  return {
    documents,
    isLoading,
    error,
    fetchDocuments,
    deleteDocument,
    refetch: fetchDocuments,
  };
}