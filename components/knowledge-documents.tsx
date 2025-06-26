'use client';

import { useEffect, useState } from 'react';
import { FileText, Trash2, Download, Calendar, HardDrive, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useKnowledgeDocuments } from '@/hooks/use-knowledge-upload';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';

interface KnowledgeDocumentDisplay {
  id: string;
  title: string;
  fileType: string | null;
  fileSize: number | null;
  createdAt: Date;
  updatedAt: Date;
  metadata?: any;
  hasFileUrl: boolean;
}

interface KnowledgeDocumentsProps {
  className?: string;
  onDocumentSelect?: (document: KnowledgeDocumentDisplay) => void;
}

export function KnowledgeDocuments({ 
  className, 
  onDocumentSelect 
}: KnowledgeDocumentsProps) {
  const { documents, isLoading, error, fetchDocuments, deleteDocument } = useKnowledgeDocuments();

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const formatFileSize = (bytes: number | null) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileTypeIcon = (fileType: string | null) => {
    switch (fileType?.toLowerCase()) {
      case 'pdf':
        return 'PDF';
      case 'docx':
        return 'DOC';
      case 'txt':
        return 'TXT';
      case 'md':
        return 'MD';
      default:
        return 'FILE';
    }
  };

  const handleDelete = async (document: KnowledgeDocumentDisplay) => {
    await deleteDocument(document.id);
  };

  if (isLoading) {
    return (
      <Card className={cn('p-6', className)}>
        <div className="flex items-center justify-center space-y-4">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading documents...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn('p-6', className)}>
        <div className="text-center text-destructive">
          <p className="font-medium">Failed to load documents</p>
          <p className="text-sm mt-1">{error}</p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchDocuments}
            className="mt-3"
          >
            Try Again
          </Button>
        </div>
      </Card>
    );
  }

  if (documents.length === 0) {
    return (
      <Card className={cn('p-6', className)}>
        <div className="text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="font-medium">No knowledge documents</p>
          <p className="text-sm mt-1">Upload documents to build your AI knowledge base</p>
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Knowledge Documents</h3>
        <span className="text-sm text-muted-foreground">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-3">
        {documents.map((document) => (
          <Card key={document.id} className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3 flex-1">
                <div className="w-8 h-8 bg-primary/10 rounded flex items-center justify-center">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <h4 
                      className="font-medium truncate cursor-pointer hover:text-primary"
                      onClick={() => onDocumentSelect?.(document as KnowledgeDocumentDisplay)}
                    >
                      {document.title}
                    </h4>
                    {document.fileType && (
                      <span className="text-xs bg-muted px-2 py-1 rounded uppercase">
                        {document.fileType}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center space-x-4 mt-2 text-sm text-muted-foreground">
                    <div className="flex items-center space-x-1">
                      <HardDrive className="h-3 w-3" />
                      <span>{formatFileSize(document.fileSize)}</span>
                    </div>
                    
                    <div className="flex items-center space-x-1">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {formatDistanceToNow(new Date(document.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {document.metadata?.chunkCount && (
                      <div className="flex items-center space-x-1">
                        <FileText className="h-3 w-3" />
                        <span>{document.metadata.chunkCount} chunks</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {document.hasFileUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Download original file
                      window.open(`/api/knowledge/documents/${document.id}?download=true`, '_blank');
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Document</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete &quot;{document.title}&quot;? This will remove the document 
                        and all its processed chunks from your knowledge base. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(document as KnowledgeDocumentDisplay)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Compact version for sidebars
export function KnowledgeDocumentsCompact({ 
  className,
  onDocumentSelect 
}: KnowledgeDocumentsProps) {
  const { documents, isLoading, fetchDocuments } = useKnowledgeDocuments();

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const getFileTypeIcon = (fileType: string | null) => {
    switch (fileType?.toLowerCase()) {
      case 'pdf':
        return 'PDF';
      case 'docx':
        return 'DOC';
      case 'txt':
        return 'TXT';
      case 'md':
        return 'MD';
      default:
        return 'FILE';
    }
  };

  if (isLoading) {
    return (
      <div className={cn('p-2', className)}>
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className={cn('p-2 text-center', className)}>
        <p className="text-xs text-muted-foreground">No documents</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {documents.slice(0, 5).map((document) => (
        <div
          key={document.id}
          className="flex items-center space-x-2 p-2 rounded hover:bg-muted cursor-pointer text-sm"
          onClick={() => onDocumentSelect?.(document as KnowledgeDocumentDisplay)}
        >
          <div className="w-6 h-6 bg-primary/10 rounded flex items-center justify-center text-xs">
            <FileText className="h-3 w-3 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate font-medium">{document.title}</p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(document.createdAt), { addSuffix: true })}
            </p>
          </div>
        </div>
      ))}
      
      {documents.length > 5 && (
        <div className="p-2 text-center">
          <p className="text-xs text-muted-foreground">
            +{documents.length - 5} more documents
          </p>
        </div>
      )}
    </div>
  );
}